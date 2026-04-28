// PWA 服务工作者注册
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then((registration) => {
                console.log('SW registered: ', registration);
            })
            .catch((registrationError) => {
                console.log('SW registration failed: ', registrationError);
            });
    });
}

// 应用主要功能
class ConsultantViewer {
    constructor() {
        this.consultants = [];
        this.currentFilter = 'all';
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadConsultants();
    }

    setupEventListeners() {
        // 校区筛选
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                // 移除所有 active 类
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                // 添加 active 类到当前按钮
                e.target.classList.add('active');
                
                this.currentFilter = e.target.dataset.campus;
                this.renderConsultants();
            });
        });
    }

    async loadConsultants() {
        try {
            const response = await fetch('/api/consultants');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const consultants = await response.json();
            this.consultants = consultants.map(consultant => ({
                ...consultant,
                teachers: this.normalizeTeachers(consultant.teachers)
            }));
            this.renderConsultants();
        } catch (error) {
            console.error('加载顾问数据失败:', error);
            this.showError('加载数据失败，请稍后重试');
        }
    }

    renderConsultants() {
        const content = document.getElementById('content');
        
        // 筛选数据
        let filteredConsultants = this.consultants;
        if (this.currentFilter !== 'all') {
            filteredConsultants = this.consultants.filter(c => c.campus === this.currentFilter);
        }

        if (filteredConsultants.length === 0) {
            content.innerHTML = '<div class="loading">暂无顾问数据</div>';
            return;
        }

        // 按今天是星期几筛选
        const today = new Date().getDay(); // 0=周日, 1=周一, ..., 6=周六
        const dayNames = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        const todayName = dayNames[today];

        // 只显示今天的排班
        const todayConsultants = filteredConsultants.filter(c => c.day === todayName);

        const html = `
            <div class="consultants-grid">
                ${todayConsultants.map(consultant => this.createConsultantCard(consultant)).join('')}
            </div>
        `;

        content.innerHTML = html;
    }

    createConsultantCard(consultant) {
        return `
            <div class="consultant-card">
                <div class="consultant-name">${consultant.teachers.join(', ')}</div>
                <div class="consultant-time">
                    <span class="time-badge">进: ${consultant.checkin}</span>
                    <span class="time-badge">出: ${consultant.checkout}</span>
                </div>
                <div class="consultant-time">
                    <span>工作日: ${consultant.day}</span>
                    <span class="campus-badge">${consultant.campus}</span>
                </div>
            </div>
        `;
    }

    normalizeTeachers(teachers) {
        if (Array.isArray(teachers)) {
            return teachers.filter(Boolean).map(teacher => String(teacher).trim()).filter(Boolean);
        }

        if (typeof teachers === 'string') {
            return teachers.split(',').map(teacher => teacher.trim()).filter(Boolean);
        }

        return [];
    }

    showError(message) {
        const content = document.getElementById('content');
        content.innerHTML = `<div class="error">${message}</div>`;
    }
}

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
    new ConsultantViewer();
});
