// 甘特图应用主类
class GanttChart {
    constructor() {
        this.consultants = [];
        this.editingRecordId = null;
        this.autoRefreshMs = 15000;
        this.refreshTimer = null;
        this.isLoading = false;
        this.lastDataSignature = '';
        this.lastUpdatedAt = null;
        this.currentView = 'schedule';
        this.filters = {
            day: 'all',
            campus: 'all',
            teacher: 'all'
        };
        this.timelineStart = 7;
        this.timelineEnd = 22;
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
        this.startAutoRefresh();
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

        const content = document.getElementById('content');
        content.addEventListener('click', (e) => {
            const choice = e.target.closest('[data-picker-record-id]');
            if (choice) {
                this.openEditModal(choice.dataset.pickerRecordId);
                return;
            }

            const block = e.target.closest('[data-record-id], [data-segment-record-ids]');
            if (!block) {
                return;
            }

            if (block.dataset.segmentRecordIds) {
                this.openSegmentModal(block.dataset.segmentRecordIds);
            } else {
                this.openEditModal(block.dataset.recordId);
            }
        });

        document.getElementById('edit-close').addEventListener('click', () => this.closeEditModal());
        document.getElementById('edit-cancel').addEventListener('click', () => this.closeEditModal());
        document.getElementById('teacher-picker').addEventListener('click', (e) => this.handleTeacherPick(e));
        document.getElementById('teacher-picker').addEventListener('touchend', (e) => this.handleTeacherPick(e));
        document.getElementById('edit-modal').addEventListener('click', (e) => {
            const choice = e.target.closest('[data-picker-record-id]');
            if (choice) {
                this.openEditModal(choice.dataset.pickerRecordId);
                return;
            }

            if (e.target.id === 'edit-modal') {
                this.closeEditModal();
            }
        });
        document.getElementById('edit-form').addEventListener('submit', (e) => this.handleEditSubmit(e));
        document.getElementById('refresh-btn').addEventListener('click', () => this.loadData({ forceRender: true }));
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.stopAutoRefresh();
            } else {
                this.loadData({ forceRender: false });
                this.startAutoRefresh();
            }
        });
    }

    startAutoRefresh() {
        this.stopAutoRefresh();
        this.refreshTimer = setInterval(() => {
            if (!this.editingRecordId && !document.hidden) {
                this.loadData({ forceRender: false });
            }
        }, this.autoRefreshMs);
    }

    stopAutoRefresh() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    async loadData(options = {}) {
        const { forceRender = false } = options;
        if (this.isLoading) {
            return;
        }

        this.isLoading = true;
        this.updateSyncStatus('同步中...');

        try {
            const response = await fetch(`/api/consultants?t=${Date.now()}`, { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const nextConsultants = await response.json();
            const normalizedConsultants = this.normalizeConsultants(nextConsultants);
            const nextSignature = this.getDataSignature(normalizedConsultants);
            const hasChanged = nextSignature !== this.lastDataSignature;

            this.consultants = normalizedConsultants;
            this.lastDataSignature = nextSignature;
            this.lastUpdatedAt = new Date();
            this.updateTeacherFilter();

            if (forceRender || hasChanged) {
                this.renderContent();
            }

            this.updateSyncStatus();
        } catch (error) {
            console.error('加载数据失败:', error);
            this.updateSyncStatus('同步失败');
            this.showError('加载数据失败，请稍后重试');
        } finally {
            this.isLoading = false;
        }
    }

    getDataSignature(data) {
        return JSON.stringify(data.map(item => ({
            recordId: item.recordId,
            day: item.day,
            teachers: this.normalizeTeachers(item.teachers),
            checkin: item.checkin,
            checkout: item.checkout,
            campus: item.campus
        })));
    }

    normalizeConsultants(data) {
        if (!Array.isArray(data)) {
            return [];
        }

        return data.map(item => ({
            ...item,
            teachers: this.normalizeTeachers(item.teachers)
        }));
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

    updateSyncStatus(message = '') {
        const statusText = document.getElementById('sync-status-text');
        const refreshButton = document.getElementById('refresh-btn');
        if (!statusText || !refreshButton) {
            return;
        }

        refreshButton.disabled = this.isLoading;

        if (message) {
            statusText.innerHTML = `<strong>${message}</strong>`;
            return;
        }

        if (!this.lastUpdatedAt) {
            statusText.textContent = '尚未同步';
            return;
        }

        statusText.innerHTML = `最后同步 <strong>${this.formatClockTime(this.lastUpdatedAt)}</strong>，每 15 秒自动刷新`;
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
                             data-record-id="${this.escapeAttribute(schedule.recordId)}"
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

        const days = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
        const schedulesByDay = {};
        days.forEach(day => {
            schedulesByDay[day] = [];
        });

        filteredData.forEach(consultant => {
            if (schedulesByDay[consultant.day]) {
                schedulesByDay[consultant.day].push(consultant);
            }
        });

        const hours = Array.from(
            { length: this.timelineEnd - this.timelineStart },
            (_, index) => this.timelineStart + index
        );

        let html = `
            <div class="gantt-container">
                <div class="gantt-header">
                    <span>周排班甘特图</span>
                    <span class="gantt-subtitle">横轴时间，纵轴星期</span>
                </div>
                <div class="gantt-content">
                    <div class="timeline-chart">
                        <div class="timeline-hours">
                            <div class="timeline-corner">星期</div>
                            ${hours.map(hour => `<div class="timeline-hour">${this.formatHour(hour)}</div>`).join('')}
                        </div>
        `;

        days.forEach(day => {
            const schedules = this.layoutDaySchedules(this.mergeScheduleSegments(schedulesByDay[day]));
            const laneCount = schedules.reduce((max, schedule) => Math.max(max, schedule.lane + 1), 1);

            html += `
                <div class="timeline-row" style="--lanes: ${laneCount}">
                    <div class="timeline-day">${day.replace('星期', '周')}</div>
                    <div class="timeline-lane" style="--lanes: ${laneCount}">
            `;

            if (schedules.length === 0) {
                html += '<div class="timeline-empty">暂无排班</div>';
            }

            schedules.forEach(schedule => {
                const campusClass = this.getCampusClass(schedule.campus);
                const teacherList = this.formatTeacherList(schedule.teachers);
                const recordIds = schedule.records.map(record => record.recordId);
                html += `
                    <div class="timeline-block ${campusClass}"
                         data-segment-record-ids="${this.escapeAttribute(recordIds.join('|'))}"
                         style="--start: ${schedule.startOffset}; --duration: ${schedule.duration}; --lane: ${schedule.lane}"
                         title="${this.escapeAttribute(`${schedule.campus}: ${schedule.teachers.join(', ')} ${schedule.checkin} - ${schedule.checkout}，点击选择老师修改时间`)}">
                        ${schedule.teachers.length > 1 ? `<div class="timeline-count">${schedule.teachers.length}</div>` : ''}
                        <div class="timeline-campus">${schedule.campus}</div>
                        <div class="timeline-teachers">${teacherList}</div>
                        <div class="timeline-time">${schedule.checkin} - ${schedule.checkout}</div>
                    </div>
                `;
            });

            html += '</div></div>';
        });

        html += '</div></div></div>';
        return html;
    }

    mergeScheduleSegments(schedules) {
        const segments = new Map();

        schedules.forEach(schedule => {
            const key = [
                schedule.day,
                schedule.campus,
                this.normalizeTimeKey(schedule.checkin),
                this.normalizeTimeKey(schedule.checkout)
            ].join('|');

            if (!segments.has(key)) {
                segments.set(key, {
                    ...schedule,
                    teachers: [],
                    records: []
                });
            }

            const segment = segments.get(key);
            schedule.teachers.forEach(teacher => {
                if (!segment.teachers.includes(teacher)) {
                    segment.teachers.push(teacher);
                }
            });
            segment.records.push(schedule);
        });

        return Array.from(segments.values());
    }

    normalizeTimeKey(timeStr) {
        return String(timeStr || '').trim().toUpperCase().replace(/\s+/g, ' ');
    }

    formatTeacherList(teachers) {
        if (teachers.length <= 3) {
            return teachers.join(', ');
        }

        return `${teachers.slice(0, 3).join(', ')} +${teachers.length - 3}`;
    }

    layoutDaySchedules(schedules) {
        const laneEnds = [];

        return schedules
            .map(schedule => {
                const start = this.parseTimeToHours(schedule.checkin);
                const end = this.parseTimeToHours(schedule.checkout);
                const safeStart = Math.min(Math.max(start, this.timelineStart), this.timelineEnd);
                const safeEnd = Math.min(Math.max(end, safeStart + 0.25), this.timelineEnd);

                return {
                    ...schedule,
                    start,
                    end,
                    startOffset: safeStart - this.timelineStart,
                    duration: Math.max(safeEnd - safeStart, 0.5)
                };
            })
            .sort((a, b) => a.start - b.start || a.end - b.end)
            .map(schedule => {
                let lane = laneEnds.findIndex(end => end <= schedule.start);
                if (lane === -1) {
                    lane = laneEnds.length;
                    laneEnds.push(schedule.end);
                } else {
                    laneEnds[lane] = schedule.end;
                }

                return { ...schedule, lane };
            });
    }

    parseTimeToHours(timeStr) {
        if (!timeStr) {
            return this.timelineStart;
        }

        const normalized = String(timeStr).trim();
        const match = normalized.match(/(\d{1,2})(?:[:.](\d{1,2}))?\s*(AM|PM)?/i);
        if (!match) {
            return this.timelineStart;
        }

        let hour = parseInt(match[1], 10);
        const minute = parseInt(match[2] || '0', 10);
        const period = match[3] ? match[3].toLowerCase() : '';

        if (period === 'pm' && hour !== 12) {
            hour += 12;
        } else if (period === 'am' && hour === 12) {
            hour = 0;
        }

        return hour + minute / 60;
    }

    formatHour(hour) {
        const suffix = hour >= 12 ? 'PM' : 'AM';
        const hour12 = hour % 12 || 12;
        return `${hour12}:00 ${suffix}`;
    }

    formatClockTime(date) {
        return date.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    }

    getCampusClass(campus) {
        const normalized = String(campus || '').toLowerCase();
        if (normalized === 'pu' || normalized === 'hm' || normalized === 'subang') {
            return normalized;
        }
        return 'default-campus';
    }

    openSegmentModal(recordIdsText) {
        const recordIds = recordIdsText.split('|').filter(Boolean);
        const schedules = recordIds
            .map(recordId => this.consultants.find(item => item.recordId === recordId))
            .filter(Boolean);

        if (schedules.length === 0) {
            this.showToastError('找不到这个班段');
            return;
        }

        if (schedules.length === 1) {
            this.openEditModal(schedules[0].recordId);
            return;
        }

        this.editingRecordId = null;
        const first = schedules[0];
        document.getElementById('edit-meta').innerHTML = `
            <div><strong>班段:</strong> ${this.escapeHtml(first.day)} ${this.escapeHtml(first.campus)}</div>
            <div><strong>时间:</strong> ${this.escapeHtml(first.checkin)} - ${this.escapeHtml(first.checkout)}</div>
            <div><strong>请选择要修改的老师</strong></div>
        `;
        document.getElementById('teacher-picker').innerHTML = schedules.map(schedule => `
            <button class="teacher-choice" type="button" data-picker-record-id="${this.escapeAttribute(schedule.recordId)}">
                ${this.escapeHtml(schedule.teachers.join(', '))}
            </button>
        `).join('');
        this.bindTeacherChoices();
        document.getElementById('teacher-picker').classList.add('open');
        document.getElementById('edit-checkin').value = first.checkin;
        document.getElementById('edit-checkout').value = first.checkout;
        document.getElementById('edit-error').textContent = '';
        document.getElementById('edit-submit').disabled = true;
        document.getElementById('edit-submit').textContent = '先选择老师';

        const modal = document.getElementById('edit-modal');
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
        this.updateSyncStatus('编辑中，已暂停自动刷新');
    }

    bindTeacherChoices() {
        document.querySelectorAll('[data-picker-record-id]').forEach(button => {
            const pick = (e) => this.handleTeacherPick(e);
            button.onclick = pick;
            button.ontouchend = pick;
        });
    }

    handleTeacherPick(e) {
        const choice = e.target.closest('[data-picker-record-id]');
        if (!choice) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        this.openEditModal(choice.dataset.pickerRecordId);
    }

    openEditModal(recordId) {
        const schedule = this.consultants.find(item => item.recordId === recordId);
        if (!schedule) {
            this.showToastError('找不到这条排班记录');
            return;
        }

        this.editingRecordId = recordId;
        document.getElementById('edit-meta').innerHTML = `
            <div><strong>星期:</strong> ${this.escapeHtml(schedule.day)}</div>
            <div><strong>老师:</strong> ${this.escapeHtml(schedule.teachers.join(', '))}</div>
            <div><strong>校区:</strong> ${this.escapeHtml(schedule.campus)}</div>
        `;
        document.getElementById('edit-checkin').value = schedule.checkin;
        document.getElementById('edit-checkout').value = schedule.checkout;
        document.getElementById('edit-error').textContent = '';
        document.getElementById('teacher-picker').innerHTML = '';
        document.getElementById('teacher-picker').classList.remove('open');
        document.getElementById('edit-submit').disabled = false;
        document.getElementById('edit-submit').textContent = '保存到 Lark';

        const modal = document.getElementById('edit-modal');
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
        document.getElementById('edit-checkin').focus();
        this.updateSyncStatus('编辑中，已暂停自动刷新');
    }

    closeEditModal() {
        this.editingRecordId = null;
        const modal = document.getElementById('edit-modal');
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
        this.updateSyncStatus();
    }

    async handleEditSubmit(e) {
        e.preventDefault();

        const schedule = this.consultants.find(item => item.recordId === this.editingRecordId);
        if (!schedule) {
            this.showEditError('找不到这条排班记录');
            return;
        }

        const checkin = document.getElementById('edit-checkin').value.trim();
        const checkout = document.getElementById('edit-checkout').value.trim();

        if (!checkin || !checkout) {
            this.showEditError('进出时间不能为空');
            return;
        }

        if (this.parseTimeToHours(checkout) <= this.parseTimeToHours(checkin)) {
            this.showEditError('出时间必须晚于进时间');
            return;
        }

        const submitButton = document.getElementById('edit-submit');
        submitButton.disabled = true;
        submitButton.textContent = '保存中...';
        this.showEditError('');

        try {
            const response = await fetch('/api/update-consultant', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    recordId: schedule.recordId,
                    checkin,
                    checkout
                })
            });
            const result = await response.json();

            if (!response.ok || !result.ok) {
                throw new Error(result.error || '更新失败');
            }

            this.closeEditModal();
            await this.loadData();
        } catch (error) {
            this.showEditError(error.message || '更新失败');
            submitButton.disabled = false;
            submitButton.textContent = '保存到 Lark';
        }
    }

    showEditError(message) {
        document.getElementById('edit-error').textContent = message;
    }

    showToastError(message) {
        const content = document.getElementById('content');
        const error = document.createElement('div');
        error.className = 'loading';
        error.style.color = '#dc2626';
        error.textContent = message;
        content.prepend(error);
        setTimeout(() => error.remove(), 2500);
    }

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    escapeAttribute(value) {
        return this.escapeHtml(value);
    }

    renderSummaryView() {
        const filteredData = this.getFilteredData();
        
        // 统计数据
        const stats = {
            totalSchedules: filteredData.length,
            totalTeachers: new Set(filteredData.flatMap(c => c.teachers)).size,
            totalWeeklyHours: 0,
            totalMonthlyHours: 0,
            campusStats: {},
            dayStats: {},
            teacherStats: {}
        };

        filteredData.forEach(consultant => {
            const scheduleHours = this.calculateScheduleHours(consultant);
            stats.totalWeeklyHours += scheduleHours * consultant.teachers.length;

            // 校区统计
            stats.campusStats[consultant.campus] = (stats.campusStats[consultant.campus] || 0) + 1;
            
            // 星期统计
            stats.dayStats[consultant.day] = (stats.dayStats[consultant.day] || 0) + 1;
            
            // 老师统计
            consultant.teachers.forEach(teacher => {
                if (!stats.teacherStats[teacher]) {
                    stats.teacherStats[teacher] = {
                        schedules: 0,
                        weeklyHours: 0
                    };
                }

                stats.teacherStats[teacher].schedules += 1;
                stats.teacherStats[teacher].weeklyHours += scheduleHours;
            });
        });

        stats.totalMonthlyHours = stats.totalWeeklyHours * 4;

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
                <div class="summary-card">
                    <h3>每周总小时</h3>
                    <div class="number">${this.formatHours(stats.totalWeeklyHours)}</div>
                </div>
                <div class="summary-card">
                    <h3>每月总小时</h3>
                    <div class="number">${this.formatHours(stats.totalMonthlyHours)}</div>
                </div>
            </div>

            <div class="gantt-container">
                <div class="gantt-header">
                    <span>👨‍🏫 老师工时统计</span>
                    <span class="gantt-subtitle">月小时 = 周小时 x 4</span>
                </div>
                <div class="hours-table-wrap">
                    <table class="hours-table">
                        <thead>
                            <tr>
                                <th>老师</th>
                                <th>每周 Hours</th>
                                <th>每月 Hours</th>
                                <th>排班次数</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${this.renderTeacherHoursRows(stats.teacherStats)}
                        </tbody>
                    </table>
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

    renderTeacherHoursRows(teacherStats) {
        const rows = Object.entries(teacherStats)
            .sort(([, a], [, b]) => b.weeklyHours - a.weeklyHours)
            .map(([teacher, stat]) => {
                const monthlyHours = stat.weeklyHours * 4;

                return `
                    <tr>
                        <td>${teacher}</td>
                        <td class="number-cell">${this.formatHours(stat.weeklyHours)}</td>
                        <td class="number-cell">${this.formatHours(monthlyHours)}</td>
                        <td class="muted-cell">${stat.schedules}</td>
                    </tr>
                `;
            });

        return rows.length ? rows.join('') : '<tr><td colspan="4" class="muted-cell">暂无老师工时数据</td></tr>';
    }

    calculateScheduleHours(schedule) {
        const start = this.parseTimeToHours(schedule.checkin);
        const end = this.parseTimeToHours(schedule.checkout);
        return Math.max(end - start, 0);
    }

    formatHours(hours) {
        const rounded = Math.round(hours * 10) / 10;
        return Number.isInteger(rounded) ? `${rounded}h` : `${rounded.toFixed(1)}h`;
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
    window.ganttChart = new GanttChart();
});
