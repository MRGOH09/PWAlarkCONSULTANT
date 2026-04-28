// 甘特图应用主类
class GanttChart {
    constructor() {
        this.consultants = [];
        this.currentView = 'teacher';
        this.filters = {
            day: 'all',
            campus: 'all',
            teacher: 'all'
        };
        this.timeSlots = [
            '7:00-8:00', '8:00-9:00', '9:00-10:00', '10:00-11:00', '11:00-12:00',
            '12:00-13:00', '13:00-14:00', '14:00-15:00', '15:00-16:00', '16:00-17:00',
            '17:00-18:00', '18:00-19:00', '19:00-20:00', '20:00-21:00', '21:00-22:00'
        ];
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadData();
    }

    setupEventListeners() {
        // 视图切换
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                this.currentView = e.target.dataset.view;
                this.updateTeacherFilter();
                this.renderContent();
            });
        });

        // 筛选按钮
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const group = e.target.closest('.filter-group');
                group.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                
                if (e.target.dataset.day) {
                    this.filters.day = e.target.dataset.day;
                } else if (e.target.dataset.campus) {
                    this.filters.campus = e.target.dataset.campus;
                } else if (e.target.dataset.teacher) {
                    this.filters.teacher = e.target.dataset.teacher;
                }
                
                this.renderContent();
            });
        });
    }

    async loadData() {
        try {
            const response = await fetch('/api/consultants');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            this.consultants = await response.json();
            this.updateTeacherFilter();
            this.renderContent();
        } catch (error) {
            console.error('加载数据失败:', error);
            this.showError('加载数据失败，请稍后重试');
        }
    }

    updateTeacherFilter() {
        const teacherFilter = document.getElementById('teacher-filter');
        if (this.currentView === 'teacher') {
            teacherFilter.style.display = 'flex';
            
            // 获取所有老师列表
            const allTeachers = new Set();
            this.consultants.forEach(consultant => {
                consultant.teachers.forEach(teacher => allTeachers.add(teacher));
            });
            
            // 更新老师筛选按钮
            const teacherButtons = Array.from(allTeachers).sort().map(teacher => 
                `<button class="filter-btn" data-teacher="${teacher}">${teacher}</button>`
            ).join('');
            
            teacherFilter.innerHTML = `
                <span class="filter-label">老师:</span>
                <button class="filter-btn active" data-teacher="all">全部</button>
                ${teacherButtons}
            `;
            
            // 重新绑定事件
            teacherFilter.querySelectorAll('.filter-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    teacherFilter.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                    e.target.classList.add('active');
                    this.filters.teacher = e.target.dataset.teacher;
                    this.renderContent();
                });
            });
        } else {
            teacherFilter.style.display = 'none';
        }
    }

    getFilteredData() {
        return this.consultants.filter(consultant => {
            // 星期筛选
            if (this.filters.day !== 'all' && consultant.day !== this.filters.day) {
                return false;
            }
            
            // 校区筛选
            if (this.filters.campus !== 'all' && consultant.campus !== this.filters.campus) {
                return false;
            }
            
            // 老师筛选
            if (this.filters.teacher !== 'all' && !consultant.teachers.includes(this.filters.teacher)) {
                return false;
            }
            
            return true;
        });
    }

    renderContent() {
        const content = document.getElementById('content');
        
        switch (this.currentView) {
            case 'teacher':
                content.innerHTML = this.renderTeacherView();
                break;
            case 'schedule':
                content.innerHTML = this.renderScheduleView();
                break;
            case 'summary':
                content.innerHTML = this.renderSummaryView();
                break;
        }
    }

    renderTeacherView() {
        const filteredData = this.getFilteredData();
        
        // 按老师分组
        const teacherSchedules = {};
        filteredData.forEach(consultant => {
            consultant.teachers.forEach(teacher => {
                if (!teacherSchedules[teacher]) {
                    teacherSchedules[teacher] = [];
                }
                teacherSchedules[teacher].push(consultant);
            });
        });

        if (Object.keys(teacherSchedules).length === 0) {
            return '<div class="loading">没有找到符合条件的数据</div>';
        }

        const days = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
        
        let html = `
            <div class="gantt-container">
                <div class="gantt-header">👨‍🏫 老师工作时间表</div>
                <div class="gantt-content">
                    <table class="gantt-table">
                        <thead>
                            <tr>
                                <th class="teacher-name">老师</th>
                                ${days.map(day => `<th>${day}</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>
        `;

        Object.keys(teacherSchedules).sort().forEach(teacher => {
            html += `<tr><td class="teacher-name">${teacher}</td>`;
            
            days.forEach(day => {
                const daySchedules = teacherSchedules[teacher].filter(s => s.day === day);
                html += '<td class="time-slot">';
                
                daySchedules.forEach(schedule => {
                    const campusClass = schedule.campus.toLowerCase();
                    html += `
                        <div class="schedule-block ${campusClass}" 
                             title="${schedule.campus}: ${schedule.checkin} - ${schedule.checkout}">
                            ${schedule.campus}<br>
                            ${schedule.checkin}-${schedule.checkout}
                        </div>
                    `;
                });
                
                html += '</td>';
            });
            
            html += '</tr>';
        });

        html += '</tbody></table></div></div>';
        return html;
    }

    renderScheduleView() {
        const filteredData = this.getFilteredData();
        
        if (filteredData.length === 0) {
            return '<div class="loading">没有找到符合条件的数据</div>';
        }

        // 按时间段和日期分组
        const scheduleGrid = {};
        const days = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
        
        // 初始化网格
        this.timeSlots.forEach(slot => {
            scheduleGrid[slot] = {};
            days.forEach(day => {
                scheduleGrid[slot][day] = [];
            });
        });

        // 填充数据
        filteredData.forEach(consultant => {
            const timeRange = this.getTimeSlot(consultant.checkin, consultant.checkout);
            timeRange.forEach(slot => {
                if (scheduleGrid[slot] && scheduleGrid[slot][consultant.day]) {
                    scheduleGrid[slot][consultant.day].push(consultant);
                }
            });
        });

        let html = `
            <div class="gantt-container">
                <div class="gantt-header">🏫 时间段排班表</div>
                <div class="gantt-content">
                    <table class="gantt-table">
                        <thead>
                            <tr>
                                <th class="teacher-name">时间</th>
                                ${days.map(day => `<th>${day}</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>
        `;

        this.timeSlots.forEach(slot => {
            html += `<tr><td class="teacher-name">${slot}</td>`;
            
            days.forEach(day => {
                const schedules = scheduleGrid[slot][day];
                html += '<td class="time-slot">';
                
                schedules.forEach(schedule => {
                    const campusClass = schedule.campus.toLowerCase();
                    const teacherList = schedule.teachers.join(', ');
                    html += `
                        <div class="schedule-block ${campusClass}" 
                             title="${schedule.campus}: ${teacherList}">
                            ${schedule.campus}<br>
                            ${teacherList}
                        </div>
                    `;
                });
                
                html += '</td>';
            });
            
            html += '</tr>';
        });

        html += '</tbody></table></div></div>';
        return html;
    }

    renderSummaryView() {
        const filteredData = this.getFilteredData();
        
        // 统计数据
        const stats = {
            totalSchedules: filteredData.length,
            totalTeachers: new Set(filteredData.flatMap(c => c.teachers)).size,
            campusStats: {},
            dayStats: {},
            teacherStats: {}
        };

        filteredData.forEach(consultant => {
            // 校区统计
            stats.campusStats[consultant.campus] = (stats.campusStats[consultant.campus] || 0) + 1;
            
            // 星期统计
            stats.dayStats[consultant.day] = (stats.dayStats[consultant.day] || 0) + 1;
            
            // 老师统计
            consultant.teachers.forEach(teacher => {
                stats.teacherStats[teacher] = (stats.teacherStats[teacher] || 0) + 1;
            });
        });

        let html = `
            <div class="summary-cards">
                <div class="summary-card">
                    <h3>总排班数</h3>
                    <div class="number">${stats.totalSchedules}</div>
                </div>
                <div class="summary-card">
                    <h3>参与老师</h3>
                    <div class="number">${stats.totalTeachers}</div>
                </div>
            </div>
            
            <div class="gantt-container">
                <div class="gantt-header">📊 校区分布</div>
                <div class="summary-cards">
        `;

        Object.entries(stats.campusStats).forEach(([campus, count]) => {
            html += `
                <div class="summary-card">
                    <h3>${campus}</h3>
                    <div class="number">${count}</div>
                </div>
            `;
        });

        html += `
                </div>
            </div>
            
            <div class="gantt-container">
                <div class="gantt-header">📅 星期分布</div>
                <div class="summary-cards">
        `;

        Object.entries(stats.dayStats).forEach(([day, count]) => {
            html += `
                <div class="summary-card">
                    <h3>${day}</h3>
                    <div class="number">${count}</div>
                </div>
            `;
        });

        html += '</div></div>';
        return html;
    }

    getTimeSlot(checkin, checkout) {
        // 将时间字符串转换为时间段数组
        // 这是一个简化的实现，实际可能需要更复杂的逻辑
        const slots = [];
        const checkinHour = this.parseTime(checkin);
        const checkoutHour = this.parseTime(checkout);
        
        for (let hour = checkinHour; hour < checkoutHour; hour++) {
            const slot = `${hour}:00-${hour + 1}:00`;
            if (this.timeSlots.includes(slot)) {
                slots.push(slot);
            }
        }
        
        return slots;
    }

    parseTime(timeStr) {
        // 解析时间字符串，如 "7.30 AM" -> 7
        const match = timeStr.match(/(\d+)\.?\d*\s*(AM|PM)/i);
        if (match) {
            let hour = parseInt(match[1]);
            const period = match[2].toLowerCase();
            
            if (period === 'pm' && hour !== 12) {
                hour += 12;
            } else if (period === 'am' && hour === 12) {
                hour = 0;
            }
            
            return hour;
        }
        return 0;
    }

    showError(message) {
        const content = document.getElementById('content');
        content.innerHTML = `<div class="loading" style="color: #ff4d4f;">${message}</div>`;
    }
}

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
    new GanttChart();
});