from flask import Flask, request, jsonify, g
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from datetime import datetime
import uuid
import json
import bcrypt
import jwt
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'change-me-in-production')
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///tasks.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

CORS(app, supports_credentials=True)
db = SQLAlchemy(app)

JWT_SECRET = app.config['SECRET_KEY']
JWT_ALGO = 'HS256'


# ==================== МОДЕЛИ ====================

class Employee(db.Model):
    __tablename__ = 'employee'
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    fio = db.Column(db.String(200), nullable=False)
    role = db.Column(db.String(30), default='employee')  # admin, project_manager, client_manager, head_data, head_dev, head_qa, employee
    department = db.Column(db.String(100))
    position = db.Column(db.String(100))
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=True)

    def set_password(self, plain: str) -> None:
        self.password_hash = bcrypt.hashpw(
            plain.encode('utf-8'),
            bcrypt.gensalt()
        ).decode('utf-8')

    def check_password(self, plain: str) -> bool:
        if not self.password_hash:
            return False
        return bcrypt.checkpw(
            plain.encode('utf-8'),
            self.password_hash.encode('utf-8')
        )

    def to_public_dict(self):
        return {
            'id': self.id,
            'fio': self.fio,
            'role': self.role,
            'department': self.department,
            'position': self.position,
            'email': self.email,
        }


class Project(db.Model):
    __tablename__ = 'project'
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = db.Column(db.String(200), nullable=False)
    department = db.Column(db.String(100))  # необязательно, может быть пустым
    deadline = db.Column(db.String(20))
    description = db.Column(db.Text, default='')
    createdBy = db.Column(db.String(36), nullable=False)  # ID создателя
    status = db.Column(db.String(20), default='active')  # active, archived
    createdAt = db.Column(db.String(50), default=lambda: datetime.now().isoformat())


class Task(db.Model):
    __tablename__ = 'task'
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, default='')
    status = db.Column(db.String(50), default='Новая')
    assigneeId = db.Column(db.String(36))
    creatorId = db.Column(db.String(36))
    projectId = db.Column(db.String(36))
    deadline = db.Column(db.String(20))
    estimatedHours = db.Column(db.Float, default=1.0)
    labels = db.Column(db.Text, default='[]')  # список меток ['bug', 'feature', etc]
    createdAt = db.Column(db.String(50), default=lambda: datetime.now().isoformat())
    comments = db.Column(db.Text, default='[]')
    history = db.Column(db.Text, default='[]')


class Notification(db.Model):
    __tablename__ = 'notification'
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    text = db.Column(db.Text)
    userIds = db.Column(db.Text, default='[]')
    readBy = db.Column(db.Text, default='[]')
    createdAt = db.Column(db.String(50), default=lambda: datetime.now().isoformat())
    isArchived = db.Column(db.Boolean, default=False)  # <--- ДОБАВИТЬ ЭТУ СТРОКУ


# ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

def _parse_json_list(raw, default=None):
    if default is None:
        default = []
    if not raw:
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return default


# ==================== ПРОВЕРКА ПРАВ ====================

def can_create_project(user):
    """Кто может создавать проекты"""
    return user.role in ['admin', 'project_manager', 'client_manager', 
                         'head_data', 'head_dev', 'head_qa']

def can_edit_project(user, project):
    """Кто может редактировать проект (архивировать, менять)"""
    if user.role == 'admin':
        return True
    if user.id == project.createdBy:
        return True
    return user.role == 'project_manager'  # руководитель проектов может всё

def can_edit_task(user, task, employees):
    """Кто может редактировать задачу (статус, назначение, метки)"""
    if user.role == 'admin':
        return True
    if user.id == task.assigneeId:
        return True
    
    # начальник отдела исполнителя
    assignee = next((e for e in employees if e.id == task.assigneeId), None)
    if assignee and assignee.department == user.department and user.role.startswith('head_'):
        return True
    
    # создатель проекта
    project = Project.query.get(task.projectId)
    if project and user.id == project.createdBy:
        return True
    
    return user.role == 'project_manager'


# ==================== JWT ФУНКЦИИ ====================

def create_token(user_id: str) -> str:
    return jwt.encode({'sub': user_id}, JWT_SECRET, algorithm=JWT_ALGO)

def decode_token(token: str):
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.PyJWTError:
        return None

def get_bearer_token():
    h = request.headers.get('Authorization', '') or ''
    if h.lower().startswith('bearer '):
        return h[7:].strip()
    return None


# ==================== AUTH MIDDLEWARE ====================

@app.before_request
def attach_current_user():
    g.current_user = None
    if not request.path.startswith('/api'):
        return
    if request.method == 'OPTIONS':
        return
    if request.path == '/api/auth/login' and request.method == 'POST':
        return

    token = get_bearer_token()
    if not token:
        return jsonify({'error': 'Unauthorized', 'message': 'Missing token'}), 401
    payload = decode_token(token)
    if not payload or not payload.get('sub'):
        return jsonify({'error': 'Unauthorized', 'message': 'Invalid token'}), 401
    user = db.session.get(Employee, payload['sub'])
    if not user:
        return jsonify({'error': 'Unauthorized', 'message': 'User not found'}), 401
    g.current_user = user


# ==================== AUTH API ====================

@app.route('/api/auth/login', methods=['POST'])
def auth_login():
    data = request.json or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    if not email or not password:
        return jsonify({'success': False, 'message': 'Email и пароль обязательны'}), 400

    user = Employee.query.filter_by(email=email).first()
    if not user or not user.check_password(password):
        return jsonify({'success': False, 'message': 'Неверный email или пароль'}), 401

    token = create_token(user.id)
    return jsonify({
        'success': True,
        'user': user.to_public_dict(),
        'token': token,
    })

@app.route('/api/auth/me', methods=['GET'])
def auth_me():
    return jsonify({'user': g.current_user.to_public_dict()})

@app.route('/api/auth/register', methods=['POST'])
def auth_register():
    if not g.current_user or g.current_user.role != 'admin':
        return jsonify({'error': 'Forbidden'}), 403
    data = request.json or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    fio = (data.get('fio') or '').strip()
    if not email or not password or not fio:
        return jsonify({'error': 'email, password и fio обязательны'}), 400
    if Employee.query.filter_by(email=email).first():
        return jsonify({'error': 'Email уже занят'}), 409

    emp = Employee(
        id=str(uuid.uuid4()),
        fio=fio,
        role=data.get('role', 'employee'),
        department=data.get('department', ''),
        position=data.get('position', ''),
        email=email,
    )
    emp.set_password(password)
    db.session.add(emp)
    db.session.commit()
    return jsonify({'success': True, 'user': emp.to_public_dict()}), 201


# ==================== EMPLOYEES API ====================

@app.route('/api/employees', methods=['GET'])
def get_employees():
    employees = Employee.query.all()
    return jsonify([e.to_public_dict() for e in employees])

@app.route('/api/employees/<id>', methods=['PUT'])
def update_employee(id):
    emp = db.session.get(Employee, id)
    if not emp:
        return jsonify({'error': 'Not found'}), 404
    data = request.json or {}
    if 'role' in data and g.current_user.role == 'admin':
        emp.role = data['role']
    if 'department' in data:
        emp.department = data['department']
    if 'position' in data:
        emp.position = data['position']
    if 'fio' in data:
        emp.fio = data['fio']
    if 'email' in data and data['email']:
        new_email = data['email'].strip().lower()
        other = Employee.query.filter(Employee.email == new_email, Employee.id != emp.id).first()
        if other:
            return jsonify({'error': 'Email занят'}), 409
        emp.email = new_email
    if data.get('password'):
        emp.set_password(data['password'])
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/employees/<id>', methods=['DELETE'])
def delete_employee(id):
    if not g.current_user or g.current_user.role != 'admin':
        return jsonify({'error': 'Forbidden'}), 403
    emp = db.session.get(Employee, id)
    if not emp:
        return jsonify({'error': 'Not found'}), 404
    if emp.id == g.current_user.id:
        return jsonify({'error': 'Нельзя удалить самого себя'}), 400
    admin_count = Employee.query.filter_by(role='admin').count()
    if emp.role == 'admin' and admin_count <= 1:
        return jsonify({'error': 'Нельзя удалить единственного администратора'}), 400
    db.session.delete(emp)
    db.session.commit()
    return jsonify({'success': True})


# ==================== PROJECTS API ====================

@app.route('/api/projects', methods=['GET'])
def get_projects():
    projects = Project.query.filter_by(status='active').all()
    return jsonify([{
        'id': p.id,
        'name': p.name,
        'department': p.department,
        'deadline': p.deadline,
        'description': p.description,
        'createdBy': p.createdBy,
        'status': p.status,
        'createdAt': p.createdAt
    } for p in projects])

@app.route('/api/projects/archived', methods=['GET'])
def get_archived_projects():
    if not g.current_user or g.current_user.role not in ['admin', 'project_manager']:
        return jsonify({'error': 'Forbidden'}), 403
    projects = Project.query.filter_by(status='archived').all()
    return jsonify([{
        'id': p.id,
        'name': p.name,
        'department': p.department,
        'deadline': p.deadline,
        'description': p.description,
        'createdBy': p.createdBy,
        'status': p.status,
        'createdAt': p.createdAt
    } for p in projects])

@app.route('/api/projects', methods=['POST'])
def create_project():
    if not can_create_project(g.current_user):
        return jsonify({'error': 'Forbidden', 'message': 'У вас нет прав на создание проектов'}), 403
    
    data = request.json
    if not data.get('name'):
        return jsonify({'error': 'Название проекта обязательно'}), 400
    
    project = Project(
        id=str(uuid.uuid4()),
        name=data['name'],
        department=data.get('department', ''),
        deadline=data.get('deadline', ''),
        description=data.get('description', ''),
        createdBy=g.current_user.id,
        status='active'
    )
    db.session.add(project)
    db.session.commit()
    return jsonify({'id': project.id}), 201

@app.route('/api/projects/<id>', methods=['PUT'])
def update_project(id):
    project = db.session.get(Project, id)
    if not project:
        return jsonify({'error': 'Not found'}), 404
    if not can_edit_project(g.current_user, project):
        return jsonify({'error': 'Forbidden'}), 403
    
    data = request.json
    if 'name' in data:
        project.name = data['name']
    if 'department' in data:
        project.department = data['department']
    if 'deadline' in data:
        project.deadline = data['deadline']
    if 'description' in data:
        project.description = data['description']
    if 'status' in data and data['status'] in ['active', 'archived']:
        project.status = data['status']
    
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/projects/<id>', methods=['DELETE'])
def archive_project(id):
    project = db.session.get(Project, id)
    if not project:
        return jsonify({'error': 'Not found'}), 404
    if not can_edit_project(g.current_user, project):
        return jsonify({'error': 'Forbidden'}), 403
    
    project.status = 'archived'
    db.session.commit()
    return jsonify({'success': True})


# ==================== TASKS API ====================

@app.route('/api/tasks', methods=['GET'])
def get_tasks():
    tasks = Task.query.all()
    out = []
    for t in tasks:
        out.append({
            'id': t.id,
            'title': t.title,
            'description': t.description,
            'status': t.status,
            'assigneeId': t.assigneeId,
            'creatorId': t.creatorId,
            'projectId': t.projectId,
            'deadline': t.deadline,
            'estimatedHours': t.estimatedHours,
            'labels': _parse_json_list(t.labels),
            'createdAt': t.createdAt,
            'comments': _parse_json_list(t.comments),
            'history': _parse_json_list(t.history),
        })
    return jsonify(out)

@app.route('/api/tasks', methods=['POST'])
def create_task():
    data = request.json
    task = Task(
        id=str(uuid.uuid4()),
        title=data['title'],
        description=data.get('description', ''),
        status=data.get('status', 'Новая'),
        assigneeId=data['assigneeId'],
        creatorId=data['creatorId'],
        projectId=data.get('projectId', ''),
        deadline=data.get('deadline', datetime.now().strftime('%Y-%m-%d')),
        estimatedHours=data.get('estimatedHours', 1.0),
        labels=json.dumps(data.get('labels', []), ensure_ascii=False)
    )
    db.session.add(task)
    db.session.commit()
    return jsonify({'id': task.id}), 201

@app.route('/api/tasks/<id>', methods=['PUT'])
def update_task(id):
    task = db.session.get(Task, id)
    if not task:
        return jsonify({'error': 'Not found'}), 404
    data = request.json
    
    # Проверка прав через вспомогательную функцию
    employees = Employee.query.all()
    if not can_edit_task(g.current_user, task, employees):
        return jsonify({'error': 'Forbidden', 'message': 'Нет прав на редактирование'}), 403
    
    if 'status' in data:
        task.status = data['status']
    if 'assigneeId' in data:
        task.assigneeId = data['assigneeId']
    if 'labels' in data:
        task.labels = json.dumps(data['labels'], ensure_ascii=False)
    if 'comments' in data:
        task.comments = json.dumps(data['comments'], ensure_ascii=False)
    if 'history' in data:
        task.history = json.dumps(data['history'], ensure_ascii=False)
    
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/tasks/<id>', methods=['DELETE'])
def delete_task(id):
    if not g.current_user or g.current_user.role != 'admin':
        return jsonify({'error': 'Forbidden', 'message': 'Только администратор может удалять задачи'}), 403
    
    task = db.session.get(Task, id)
    if not task:
        return jsonify({'error': 'Not found', 'message': 'Задача не найдена'}), 404
    
    db.session.delete(task)
    db.session.commit()
    return jsonify({'success': True})


# ==================== NOTIFICATIONS API ====================

@app.route('/api/notifications', methods=['GET'])
def get_notifications():
    notifications = Notification.query.all()
    return jsonify([{
        'id': n.id,
        'text': n.text,
        'userIds': _parse_json_list(n.userIds),
        'readBy': _parse_json_list(n.readBy),
        'createdAt': n.createdAt
    } for n in notifications])

@app.route('/api/notifications', methods=['POST'])
def create_notification():
    data = request.json
    notif = Notification(
        id=str(uuid.uuid4()),
        text=data.get('text', ''),
        userIds=json.dumps(data.get('userIds', []), ensure_ascii=False),
        readBy='[]',
        createdAt=datetime.now().isoformat()
    )
    db.session.add(notif)
    db.session.commit()
    return jsonify({'id': notif.id}), 201

@app.route('/api/notifications/<id>', methods=['DELETE'])
def delete_notification(id):
    if not g.current_user:
        return jsonify({'error': 'Unauthorized'}), 401
    notif = db.session.get(Notification, id)
    if not notif:
        return jsonify({'error': 'Not found'}), 404
    db.session.delete(notif)
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/notifications/<id>/read', methods=['PUT'])
def mark_notification_read(id):
    if not g.current_user:
        return jsonify({'error': 'Unauthorized'}), 401
    notif = db.session.get(Notification, id)
    if not notif:
        return jsonify({'error': 'Not found'}), 404
    readBy = _parse_json_list(notif.readBy)
    if g.current_user.id not in readBy:
        readBy.append(g.current_user.id)
        notif.readBy = json.dumps(readBy, ensure_ascii=False)
        db.session.commit()
    return jsonify({'success': True})

@app.route('/api/notifications/<id>', methods=['PUT'])
def update_notification(id):
    if not g.current_user:
        return jsonify({'error': 'Unauthorized'}), 401
    notif = db.session.get(Notification, id)
    if not notif:
        return jsonify({'error': 'Not found'}), 404
    data = request.json
    if 'userIds' in data:
        notif.userIds = json.dumps(data['userIds'], ensure_ascii=False)
    if 'readBy' in data:
        notif.readBy = json.dumps(data['readBy'], ensure_ascii=False)
    db.session.commit()
    return jsonify({'success': True})


# ==================== ИНИЦИАЛИЗАЦИЯ БД ====================

def init_db():
    db.create_all()
    
    # Добавляем тестовых сотрудников, если их нет
    if Employee.query.count() == 0:
        def emp_row(_id, fio, role, department, position, email, password):
            e = Employee(
                id=_id,
                fio=fio,
                role=role,
                department=department,
                position=position,
                email=email
            )
            e.set_password(password)
            return e
        
        employees = [
            # Администрация
            emp_row('admin1', 'Тагиев Руслан', 'admin', 'Администрация', 'Генеральный директор', 'admin@cifra.local', 'Admin'),
            
            # Управление проектами
            emp_row('pm1', 'Сергей Иванов', 'project_manager', 'Управление проектами', 'Руководитель проектов', 'sergey@cifra.local', '123456'),
            
            # Отдел работы с клиентами
            emp_row('cl1', 'Анна Смирнова', 'client_manager', 'Отдел работы с клиентами', 'Руководитель отдела', 'anna@cifra.local', '123456'),
            emp_row('cl_emp1', 'Дмитрий Козлов', 'employee', 'Отдел работы с клиентами', 'Менеджер по работе с клиентами', 'kozlov@cifra.local', '123456'),
            
            # Отдел цифровой обработки данных
            emp_row('hd1', 'Елена Воронцова', 'head_data', 'Отдел цифровой обработки данных', 'Начальник отдела', 'vorontsova@cifra.local', '123456'),
            emp_row('data1', 'Иван Петров', 'employee', 'Отдел цифровой обработки данных', 'Специалист по обработке данных', 'petrov@cifra.local', '123456'),
            emp_row('data2', 'Мария Сидорова', 'employee', 'Отдел цифровой обработки данных', 'Аналитик данных', 'sidorova@cifra.local', '123456'),
            
            # Отдел разработки ПО
            emp_row('hd2', 'Алексей Новиков', 'head_dev', 'Отдел разработки ПО', 'Начальник отдела', 'novikov@cifra.local', '123456'),
            emp_row('dev1', 'Константин Морозов', 'employee', 'Отдел разработки ПО', 'Backend-разработчик', 'morozov@cifra.local', '123456'),
            emp_row('dev2', 'Ольга Соколова', 'employee', 'Отдел разработки ПО', 'Frontend-разработчик', 'sokolova@cifra.local', '123456'),
            emp_row('dev3', 'Павел Кузнецов', 'employee', 'Отдел разработки ПО', 'DevOps-инженер', 'kuznetsov@cifra.local', '123456'),
            
            # Отдел тестирования
            emp_row('hd3', 'Татьяна Волкова', 'head_qa', 'Отдел тестирования', 'Начальник отдела', 'volkova@cifra.local', '123456'),
            emp_row('qa1', 'Артем Белов', 'employee', 'Отдел тестирования', 'Тестировщик', 'belov@cifra.local', '123456'),
        ]
        for e in employees:
            db.session.add(e)
        
        db.session.commit()
        print(f"✅ Добавлено {len(employees)} сотрудников")


with app.app_context():
    init_db()

if __name__ == '__main__':
    app.run(debug=True, port=5000)