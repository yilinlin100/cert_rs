let allQuestions = [];
let currentQuestions = [];
let currentIndex = 0;
let lastAllIndex = 0; // 记录全部题库的进度
let mode = 'all'; // 'all' or 'wrong' or 'fav'
let wrongQuestionsIds = new Set();
let favQuestionsIds = new Set();
let answeredStatus = {}; // { qId: { selected: 'A', isCorrect: true } }
let currentSelection = new Set(); // 用于多选题的临时选项

// 模拟考试相关
let examQuestions = [];
let examAnswers = {}; // { qId: 'A' }
let examTimerInterval = null;
const EXAM_DURATION = 90 * 60; // 90分钟
let timeRemaining = EXAM_DURATION;
let examWrongIds = []; // 本次做错且原来在错题集外的错题，以及本次做对且原来在错题集内的正确题处理逻辑在submitExam中实现

// 初始化
async function init() {
    try {
        // 从当前目录异步加载独立的数据文件
        const response = await fetch('data.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        allQuestions = await response.json();
        window.APP_QUESTIONS = allQuestions; // 兼容后续需要访问全局变量的场景
        
        // 执行平滑数据迁移（将旧的通用名称迁移到专属命名空间）
        migrateOldData();

        // 从 localStorage 加载错题和进度
        loadStorage();
        
        // 初始显示
        switchMode('all', false);
        updateWrongCount();
        updateFavCount();
    } catch (error) {
        console.error('Failed to load questions:', error);
        document.getElementById('q-text').innerText = '加载题目失败，请检查 questions.json 是否存在。';
    }
}

function getStorageKey(key) {
    const examId = window.APP_EXAM_ID || 'default_exam';
    return `${key}_${examId}`;
}

function migrateOldData() {
    const oldKeys = ['ai_quiz_wrong_ids', 'ai_quiz_fav_ids', 'ai_quiz_answered_status', 'ai_quiz_last_index'];
    
    // 如果发现旧数据，并且新数据还不存在，则执行迁移
    oldKeys.forEach(oldKey => {
        const newKey = getStorageKey(oldKey);
        const oldData = localStorage.getItem(oldKey);
        
        if (oldData && !localStorage.getItem(newKey)) {
            localStorage.setItem(newKey, oldData);
            // 迁移完成后删除旧数据，避免长期留存
            localStorage.removeItem(oldKey);
            console.log(`Migrated ${oldKey} to ${newKey}`);
        }
    });
}

function loadStorage() {
    const savedWrong = localStorage.getItem(getStorageKey('ai_quiz_wrong_ids'));
    if (savedWrong) {
        wrongQuestionsIds = new Set(JSON.parse(savedWrong));
    }
    
    const savedFav = localStorage.getItem(getStorageKey('ai_quiz_fav_ids'));
    if (savedFav) {
        favQuestionsIds = new Set(JSON.parse(savedFav));
    }
    
    const savedStatus = localStorage.getItem(getStorageKey('ai_quiz_answered_status'));
    if (savedStatus) {
        answeredStatus = JSON.parse(savedStatus);
    }

    const savedIndex = localStorage.getItem(getStorageKey('ai_quiz_last_index'));
    if (savedIndex) {
        lastAllIndex = parseInt(savedIndex);
        if (mode === 'all') {
            currentIndex = lastAllIndex;
        }
    }
}

function saveStorage() {
    localStorage.setItem(getStorageKey('ai_quiz_wrong_ids'), JSON.stringify(Array.from(wrongQuestionsIds)));
    localStorage.setItem(getStorageKey('ai_quiz_fav_ids'), JSON.stringify(Array.from(favQuestionsIds)));
    localStorage.setItem(getStorageKey('ai_quiz_answered_status'), JSON.stringify(answeredStatus));
    if (mode === 'all') {
        lastAllIndex = currentIndex;
    }
    localStorage.setItem(getStorageKey('ai_quiz_last_index'), lastAllIndex);
}

function switchMode(newMode, resetIndex = true) {
    // 切换前，如果是全部题库模式，保存当前进度
    if (mode === 'all') {
        lastAllIndex = currentIndex;
    }

    if (mode === 'exam' && newMode !== 'exam') {
        stopTimer();
        document.getElementById('timer-display').classList.add('hidden');
        document.getElementById('submit-exam-btn').classList.add('hidden');
    }

    mode = newMode;
    
    if (mode === 'all') {
        currentIndex = lastAllIndex;
    } else if (resetIndex) {
        currentIndex = 0;
    }
    
    // 更新导航 UI
    document.getElementById('nav-all').classList.toggle('active', mode === 'all');
    document.getElementById('nav-wrong').classList.toggle('active', mode === 'wrong');
    document.getElementById('nav-fav').classList.toggle('active', mode === 'fav');
    document.getElementById('nav-exam').classList.toggle('active', mode === 'exam' || mode === 'exam-review');
    
    let title = '📚 全部题库';
    if (mode === 'wrong') title = '❌ 错题集';
    if (mode === 'fav') title = '⭐ 收藏题集';
    if (mode === 'exam') title = '⏱️ 模拟考试';
    if (mode === 'exam-review') title = '📖 试卷回顾';
    document.getElementById('mode-title').innerText = title;
    
    // 隐藏所有特殊状态页
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('exam-start-state').classList.add('hidden');
    document.getElementById('exam-result-state').classList.add('hidden');
    document.getElementById('quiz-card').classList.add('hidden');
    document.getElementById('exit-review-btn').classList.add('hidden');

    if (mode === 'exam') {
        document.getElementById('current-index-display').classList.add('hidden');
        document.getElementById('exam-start-state').classList.remove('hidden');
        return;
    } else {
        document.getElementById('current-index-display').classList.remove('hidden');
    }

    if (mode === 'all') {
        currentQuestions = allQuestions;
    } else if (mode === 'wrong') {
        currentQuestions = allQuestions.filter(q => wrongQuestionsIds.has(q.id));
        // 进入错题模式时，将错题的记录标记为“非本轮作答”，以便解锁重新作答，但不删除原始记录
        currentQuestions.forEach(q => {
            if (answeredStatus[q.id]) {
                answeredStatus[q.id].isWrongModeAnswer = false;
            }
        });
    } else if (mode === 'fav') {
        currentQuestions = allQuestions.filter(q => favQuestionsIds.has(q.id));
        // 进入收藏模式时，将收藏的记录标记为“非本轮作答”，以便解锁重新作答
        currentQuestions.forEach(q => {
            if (answeredStatus[q.id]) {
                answeredStatus[q.id].isFavModeAnswer = false;
            }
        });
    }
    
    if (currentQuestions.length === 0) {
        document.getElementById('empty-state').classList.remove('hidden');
        if (mode === 'fav') {
            document.getElementById('empty-state').querySelector('h3').innerText = '暂无收藏';
            document.getElementById('empty-state').querySelector('p').innerText = '还没有收藏任何题目，在刷题时点击 ☆ 可收藏题目。';
        } else {
            document.getElementById('empty-state').querySelector('h3').innerText = '暂无题目';
            document.getElementById('empty-state').querySelector('p').innerText = '当前列表中没有可练习的题目。';
        }
    } else {
        document.getElementById('quiz-card').classList.remove('hidden');
        renderQuestion();
    }
    saveStorage();
}

function renderQuestion() {
    const q = currentQuestions[currentIndex];
    if (!q) return;

    currentSelection.clear();
    // 更新文本
    document.querySelector('.q-type').innerText = q.type || '单选题';
    document.getElementById('q-text').innerText = q.question;
    document.getElementById('q-difficulty').innerText = `难度：${q.difficulty || '一般'}`;
    document.getElementById('current-index-display').innerText = `${currentIndex + 1} / ${currentQuestions.length}`;
    
    // 更新收藏按钮状态
    const favBtn = document.getElementById('fav-btn');
    if (mode === 'exam') {
        favBtn.classList.add('hidden');
    } else {
        favBtn.classList.remove('hidden');
        if (favQuestionsIds.has(q.id)) {
            favBtn.classList.add('active');
            favBtn.innerHTML = '<span class="star-icon">★</span> 已收藏';
        } else {
            favBtn.classList.remove('active');
            favBtn.innerHTML = '<span class="star-icon">☆</span> 收藏';
        }
    }
    
    // 渲染选项
    const optionsList = document.getElementById('options-list');
    optionsList.innerHTML = '';
    
    let status = answeredStatus[q.id];
    let examSelected = (mode === 'exam' || mode === 'exam-review') ? (examAnswers[q.id] || '') : '';

    // 在错题集模式下，只显示本轮错题集中的作答状态，以允许重新作答
    if (mode === 'wrong' && status && !status.isWrongModeAnswer) {
        status = null;
    }
    // 在收藏集模式下，也允许重新作答
    if (mode === 'fav' && status && !status.isFavModeAnswer) {
        status = null;
    }
    
    Object.entries(q.options).forEach(([key, value]) => {
        const optionItem = document.createElement('div');
        optionItem.className = 'option-item';
        
        const prefixSpan = document.createElement('span');
        prefixSpan.className = 'opt-prefix';
        prefixSpan.innerText = `${key}.`;
        
        const textSpan = document.createElement('span');
        textSpan.className = 'opt-text';
        textSpan.innerText = value;
        
        optionItem.appendChild(prefixSpan);
        optionItem.appendChild(textSpan);
        
        if (mode === 'exam') {
            if (examSelected.includes(key)) {
                optionItem.classList.add('selected');
                if (q.type === '多选题') {
                    currentSelection.add(key);
                }
            }
            optionItem.onclick = () => selectOption(key, optionItem, q.type);
        } else if (mode === 'exam-review') {
            const isSelected = examSelected.includes(key);
            const isAns = q.answer.includes(key);
            
            if (q.type === '多选题') {
                if (isAns && isSelected) {
                    optionItem.classList.add('correct');
                } else if (isAns && !isSelected) {
                    optionItem.classList.add('correct'); // 漏选的正确选项也标绿
                    optionItem.style.opacity = '0.7'; // 半透明表示漏选
                } else if (!isAns && isSelected) {
                    optionItem.classList.add('wrong');
                }
            } else {
                if (key === q.answer) {
                    optionItem.classList.add('correct');
                } else if (key === examSelected) {
                    optionItem.classList.add('wrong');
                }
            }
            optionItem.style.cursor = 'default';
            optionItem.classList.add('disabled');
        } else {
            // 如果已经回答过，显示状态
            if (status) {
                if (q.type === '多选题') {
                    const isSelected = status.selected && status.selected.includes(key);
                    const isAns = q.answer.includes(key);
                    if (isAns && isSelected) {
                        optionItem.classList.add('correct');
                    } else if (isAns && !isSelected) {
                        optionItem.classList.add('correct'); // 漏选的正确选项也标绿
                        optionItem.style.opacity = '0.7'; // 半透明表示漏选
                    } else if (!isAns && isSelected) {
                        optionItem.classList.add('wrong');
                    }
                } else {
                    if (key === q.answer) {
                        optionItem.classList.add('correct');
                    } else if (key === status.selected) {
                        optionItem.classList.add('wrong');
                    }
                }
                optionItem.style.cursor = 'default';
                optionItem.classList.add('disabled');
            } else {
                optionItem.onclick = () => selectOption(key, optionItem, q.type);
            }
        }
        
        optionsList.appendChild(optionItem);
    });

    // 反馈区域与按钮
    const feedbackArea = document.getElementById('feedback-area');
    const showAnsBtn = document.getElementById('show-ans-btn');
    const submitBtn = document.getElementById('submit-btn');

    if (mode === 'exam') {
        feedbackArea.classList.add('hidden');
        showAnsBtn.classList.add('hidden');
        submitBtn.classList.add('hidden');
        document.getElementById('exit-review-btn').classList.add('hidden');
    } else if (mode === 'exam-review') {
        feedbackArea.classList.remove('hidden');
        document.getElementById('correct-ans').innerText = q.answer;
        document.getElementById('analysis-text').innerText = q.analysis || '暂无详细解析。';
        showAnsBtn.classList.add('hidden');
        submitBtn.classList.add('hidden');
        document.getElementById('exit-review-btn').classList.remove('hidden');
    } else {
        document.getElementById('exit-review-btn').classList.add('hidden');
        if (status) {
            feedbackArea.classList.remove('hidden');
            document.getElementById('correct-ans').innerText = q.answer;
            document.getElementById('analysis-text').innerText = q.analysis || '暂无详细解析。';
            showAnsBtn.classList.add('hidden');
            submitBtn.classList.add('hidden');
        } else {
            feedbackArea.classList.add('hidden');
            showAnsBtn.classList.remove('hidden');
            if (q.type === '多选题') {
                submitBtn.classList.remove('hidden');
            } else {
                submitBtn.classList.add('hidden');
            }
        }
    }

    // 按钮状态
    document.getElementById('prev-btn').disabled = currentIndex === 0;
    document.getElementById('next-btn').innerText = currentIndex === currentQuestions.length - 1 ? '完成' : '下一题';
    
    // 必须答题或查看答案才能切换到下一题
    if (mode === 'all' && !status) {
        document.getElementById('next-btn').disabled = true;
    } else {
        document.getElementById('next-btn').disabled = false;
    }
}

function selectOption(key, element, type) {
    if (type === '多选题') {
        if (currentSelection.has(key)) {
            currentSelection.delete(key);
            element.classList.remove('selected');
        } else {
            currentSelection.add(key);
            element.classList.add('selected');
        }
        if (mode === 'exam') {
            examAnswers[currentQuestions[currentIndex].id] = Array.from(currentSelection).sort().join('');
        }
    } else {
        if (mode === 'exam') {
            // 单选题在考试模式下
            const options = document.querySelectorAll('.option-item');
            options.forEach(opt => opt.classList.remove('selected'));
            element.classList.add('selected');
            examAnswers[currentQuestions[currentIndex].id] = key;
            // 自动跳下一题
            setTimeout(() => nextQuestion(), 300);
        } else {
            submitAnswer(key);
        }
    }
}

function submitMultiAnswer() {
    if (currentSelection.size === 0) {
        alert('请至少选择一个选项');
        return;
    }
    const selectedStr = Array.from(currentSelection).sort().join('');
    submitAnswer(selectedStr);
}

function submitAnswer(selected) {
    const q = currentQuestions[currentIndex];
    const isCorrect = selected === q.answer;
    
    const prevStatus = answeredStatus[q.id] || {};
    answeredStatus[q.id] = {
        selected: selected,
        isCorrect: isCorrect,
        isWrongModeAnswer: mode === 'wrong' ? true : prevStatus.isWrongModeAnswer,
        isFavModeAnswer: mode === 'fav' ? true : prevStatus.isFavModeAnswer
    };

    if (!isCorrect) {
        wrongQuestionsIds.add(q.id);
        updateWrongCount();
    } else {
        // 答对了，如果存在于错题集中则将其移除
        if (wrongQuestionsIds.has(q.id)) {
            wrongQuestionsIds.delete(q.id);
            updateWrongCount();
        }
    }
    
    saveStorage();
    renderQuestion();
}

function showAnswer() {
    const q = currentQuestions[currentIndex];
    let status = answeredStatus[q.id];
    if (mode === 'wrong' && status && !status.isWrongModeAnswer) {
        status = null;
    }
    if (mode === 'fav' && status && !status.isFavModeAnswer) {
        status = null;
    }
    if (status) return;
    
    // 点击“查看答案”视为未答对，加入错题集（可选逻辑）
    const prevStatus = answeredStatus[q.id] || {};
    answeredStatus[q.id] = {
        selected: null,
        isCorrect: false,
        isWrongModeAnswer: mode === 'wrong' ? true : prevStatus.isWrongModeAnswer,
        isFavModeAnswer: mode === 'fav' ? true : prevStatus.isFavModeAnswer
    };
    wrongQuestionsIds.add(q.id);
    updateWrongCount();
    saveStorage();
    renderQuestion();
}

function nextQuestion() {
    if (currentIndex < currentQuestions.length - 1) {
        currentIndex++;
        renderQuestion();
        saveStorage();
    } else {
        if (mode === 'wrong') {
            if (wrongQuestionsIds.size > 0) {
                alert(`本轮结束！还有 ${wrongQuestionsIds.size} 道错题未完全掌握，开启下一轮复习！💪`);
                switchMode('wrong', true);
            } else {
                alert('太棒了！你已经消灭了所有的错题！🎉');
                switchMode('all', true);
            }
        } else if (mode === 'fav') {
            alert('本轮收藏题集浏览完毕！');
            switchMode('all', true);
        } else {
            alert('恭喜你，已经刷完当前列表的所有题目！');
        }
    }
}

function prevQuestion() {
    if (currentIndex > 0) {
        currentIndex--;
        renderQuestion();
        saveStorage();
    }
}

function updateWrongCount() {
    document.getElementById('wrong-count').innerText = wrongQuestionsIds.size;
}

function updateFavCount() {
    document.getElementById('fav-count').innerText = favQuestionsIds.size;
}

function toggleFav() {
    const q = currentQuestions[currentIndex];
    if (!q) return;
    
    if (favQuestionsIds.has(q.id)) {
        favQuestionsIds.delete(q.id);
        
        // 如果在收藏模式下取消收藏，特殊处理
        if (mode === 'fav') {
            currentQuestions = allQuestions.filter(item => favQuestionsIds.has(item.id));
            if (currentQuestions.length === 0) {
                document.getElementById('quiz-card').classList.add('hidden');
                document.getElementById('empty-state').classList.remove('hidden');
                document.getElementById('empty-state').querySelector('h3').innerText = '暂无收藏';
                document.getElementById('empty-state').querySelector('p').innerText = '还没有收藏任何题目，在刷题时点击 ☆ 可收藏题目。';
            } else {
                // 如果是最后一题被取消收藏，索引回退
                if (currentIndex >= currentQuestions.length) {
                    currentIndex = currentQuestions.length - 1;
                }
                renderQuestion();
            }
        } else {
            renderQuestion();
        }
    } else {
        favQuestionsIds.add(q.id);
        renderQuestion();
    }
    
    updateFavCount();
    saveStorage();
}

let resetConfirmTimeout = null;

function resetProgress() {
    const btn = document.querySelector('.reset-btn');
    if (btn.innerText === '重置学习进度') {
        btn.innerText = '⚠️ 再次点击确认重置';
        btn.style.color = '#ef4444';
        btn.style.borderColor = '#ef4444';
        
        resetConfirmTimeout = setTimeout(() => {
            btn.innerText = '重置学习进度';
            btn.style.color = '';
            btn.style.borderColor = '';
        }, 3000);
        return;
    }
    
    // 已经确认，执行重置
    clearTimeout(resetConfirmTimeout);
    btn.innerText = '重置学习进度';
    btn.style.color = '';
    btn.style.borderColor = '';

    localStorage.removeItem(getStorageKey('ai_quiz_wrong_ids'));
    localStorage.removeItem(getStorageKey('ai_quiz_answered_status'));
    localStorage.removeItem(getStorageKey('ai_quiz_last_index'));
    localStorage.removeItem(getStorageKey('ai_quiz_fav_ids'));
    
    // 清除内存状态
    wrongQuestionsIds.clear();
    answeredStatus = {};
    currentIndex = 0;
    lastAllIndex = 0;
    
    // 重新初始化 UI
    switchMode('all', true);
    updateWrongCount();
}

function jumpToCurrentProgress() {
    // 强制切换回全部题库模式（不重置索引）
    if (mode !== 'all') {
        switchMode('all', false);
    }
    
    // 在全部题库中寻找第一道未作答的题（即当前最高进度）
    let targetIndex = allQuestions.findIndex(q => {
        let status = answeredStatus[q.id];
        return !status; 
    });
    
    // 如果全都答过了，就跳到最后一题
    if (targetIndex === -1) {
        targetIndex = allQuestions.length - 1;
    }
    
    // 更新索引并渲染
    currentIndex = targetIndex;
    renderQuestion();
    saveStorage();
}

function promptJump() {
    const input = prompt(`请输入要跳转的题号 (1 - ${currentQuestions.length})：\n提示：在全部题库模式下，题号即为原始题号。`);
    if (input !== null && input.trim() !== '') {
        const num = parseInt(input, 10);
        if (!isNaN(num) && num >= 1 && num <= currentQuestions.length) {
            currentIndex = num - 1;
            renderQuestion();
            saveStorage();
        } else {
            alert('输入的题号无效或超出范围！');
        }
    }
}

// 启动
init();

// --- 模拟考试相关逻辑 ---

function generateExam() {
    // 默认使用四级配置
    let config = {
        '单选题': 80,
        '判断题': 20
    };
    
    // 根据题库名称判断等级，应用不同的题型配置
    const examId = window.APP_EXAM_ID || '';
    if (examId.includes('三级') || examId.includes('3级')) {
        config = {
            '单选题': 70,
            '判断题': 10,
            '多选题': 20
        };
    } else if (examId.includes('四级') || examId.includes('4级')) {
        config = {
            '单选题': 80,
            '判断题': 20
        };
    }
    
    let selectedQuestions = [];
    
    for (const [type, count] of Object.entries(config)) {
        const pool = allQuestions.filter(q => q.type === type);
        
        // 分离未做和已做
        const unattempted = pool.filter(q => !answeredStatus[q.id]);
        const attempted = pool.filter(q => answeredStatus[q.id]);
        
        let typeQuestions = [];
        
        // 打乱函数
        const shuffle = (array) => array.sort(() => Math.random() - 0.5);
        
        if (unattempted.length >= count) {
            typeQuestions = shuffle(unattempted).slice(0, count);
        } else {
            typeQuestions = unattempted; // 先把未做的全部拿上
            const remaining = count - typeQuestions.length;
            if (attempted.length >= remaining) {
                typeQuestions = typeQuestions.concat(shuffle(attempted).slice(0, remaining));
            } else {
                typeQuestions = typeQuestions.concat(attempted); // 题库不足也只能全拿上
            }
        }
        selectedQuestions = selectedQuestions.concat(typeQuestions);
    }
    
    // 保持题型顺序，内部已打乱
    return selectedQuestions;
}

function startExam() {
    examQuestions = generateExam();
    if (examQuestions.length === 0) {
        alert("题库为空，无法组卷！");
        return;
    }
    
    examAnswers = {};
    currentQuestions = examQuestions;
    currentIndex = 0;
    
    document.getElementById('exam-start-state').classList.add('hidden');
    document.getElementById('quiz-card').classList.remove('hidden');
    
    document.getElementById('timer-display').classList.remove('hidden');
    document.getElementById('current-index-display').classList.remove('hidden');
    document.getElementById('submit-exam-btn').classList.remove('hidden');
    
    startTimer();
    renderQuestion();
}

function startTimer() {
    timeRemaining = EXAM_DURATION;
    updateTimerDisplay();
    
    if (examTimerInterval) clearInterval(examTimerInterval);
    
    examTimerInterval = setInterval(() => {
        timeRemaining--;
        updateTimerDisplay();
        
        if (timeRemaining <= 0) {
            clearInterval(examTimerInterval);
            alert("考试时间到，系统将自动交卷！");
            submitExam();
        }
    }, 1000);
}

function stopTimer() {
    if (examTimerInterval) {
        clearInterval(examTimerInterval);
        examTimerInterval = null;
    }
    const timerEl = document.getElementById('timer-display');
    timerEl.classList.remove('urgent');
}

function updateTimerDisplay() {
    const timerEl = document.getElementById('timer-display');
    const m = Math.floor(timeRemaining / 60).toString().padStart(2, '0');
    const s = (timeRemaining % 60).toString().padStart(2, '0');
    timerEl.innerText = `${m}:${s}`;
    
    // 最后5分钟变红闪烁
    if (timeRemaining <= 300) {
        timerEl.classList.add('urgent');
    } else {
        timerEl.classList.remove('urgent');
    }
}

function submitExam() {
    stopTimer();
    let score = 0;
    examWrongIds = [];
    
    examQuestions.forEach(q => {
        const selected = examAnswers[q.id] || '';
        if (selected === q.answer) {
            score++;
            // 在错题集内且做对的题自动移除
            if (wrongQuestionsIds.has(q.id)) {
                wrongQuestionsIds.delete(q.id);
            }
        } else {
            // 本次做错，准备一键加入错题集
            if (!wrongQuestionsIds.has(q.id)) {
                examWrongIds.push(q.id);
            }
        }
    });
    
    updateWrongCount(); // 同步可能已被移除的错题数量
    saveStorage();
    
    const usedTime = EXAM_DURATION - timeRemaining;
    const um = Math.floor(usedTime / 60).toString().padStart(2, '0');
    const us = (usedTime % 60).toString().padStart(2, '0');
    
    document.getElementById('quiz-card').classList.add('hidden');
    document.getElementById('exam-result-state').classList.remove('hidden');
    document.getElementById('submit-exam-btn').classList.add('hidden');
    document.getElementById('timer-display').classList.add('hidden');
    document.getElementById('current-index-display').classList.add('hidden');
    
    document.getElementById('exam-result-desc').innerHTML = `得分：<b>${score} / ${examQuestions.length}</b><br>用时：${um}:${us}<br>本次新增错题：${examWrongIds.length}道`;
    
    const addBtn = document.getElementById('add-wrong-btn');
    const reviewBtn = document.getElementById('review-all-btn');
    
    reviewBtn.classList.remove('hidden');

    if (examWrongIds.length > 0) {
        addBtn.classList.remove('hidden');
        addBtn.innerText = '一键加入错题集';
        addBtn.disabled = false;
    } else {
        addBtn.classList.add('hidden');
    }
}

function addAllExamWrongToBank() {
    examWrongIds.forEach(id => wrongQuestionsIds.add(id));
    updateWrongCount();
    saveStorage();
    
    const addBtn = document.getElementById('add-wrong-btn');
    addBtn.innerText = '已加入错题集';
    addBtn.disabled = true;
}

// --- 答题卡与进度相关逻辑 ---

function handleProgressClick() {
    if (mode === 'exam' || mode === 'exam-review') {
        openAnswerSheet();
    } else {
        promptJump();
    }
}

function openAnswerSheet() {
    const container = document.getElementById('answer-sheet-grid');
    container.innerHTML = '';
    
    // 我们改变一下 HTML 结构，不要给 answer-sheet-grid 加 grid-container class
    container.className = 'answer-sheet-content';
    
    let currentType = null;
    let currentGrid = null;
    
    examQuestions.forEach((q, index) => {
        if (q.type !== currentType) {
            currentType = q.type;
            const section = document.createElement('div');
            section.className = 'type-section';
            
            const title = document.createElement('h4');
            title.innerText = currentType;
            section.appendChild(title);
            
            currentGrid = document.createElement('div');
            currentGrid.className = 'grid-container';
            section.appendChild(currentGrid);
            
            container.appendChild(section);
        }
        
        const item = document.createElement('div');
        item.className = 'grid-item';
        item.innerText = index + 1;
        
        if (examAnswers[q.id]) {
            item.classList.add('answered');
        }
        
        if (mode === 'exam-review') {
            const isCorrect = (examAnswers[q.id] || '') === q.answer;
            if (isCorrect) {
                item.classList.add('correct');
            } else {
                item.classList.add('wrong');
            }
        }
        
        if (index === currentIndex) {
            item.classList.add('current');
        }
        
        item.onclick = () => jumpToExamQuestion(index);
        currentGrid.appendChild(item);
    });
    
    document.getElementById('answer-sheet-modal').classList.remove('hidden');
}

function closeAnswerSheet() {
    document.getElementById('answer-sheet-modal').classList.add('hidden');
}

function jumpToExamQuestion(index) {
    closeAnswerSheet();
    currentIndex = index;
    renderQuestion();
}

// --- 试卷回顾逻辑 ---

function reviewExamAll() {
    mode = 'exam-review';
    currentQuestions = examQuestions;
    currentIndex = 0;
    
    document.getElementById('exam-result-state').classList.add('hidden');
    document.getElementById('quiz-card').classList.remove('hidden');
    document.getElementById('current-index-display').classList.remove('hidden');
    document.getElementById('mode-title').innerText = '📖 试卷回顾';
    
    renderQuestion();
}

function exitExamReview() {
    document.getElementById('quiz-card').classList.add('hidden');
    document.getElementById('exit-review-btn').classList.add('hidden');
    document.getElementById('exam-result-state').classList.remove('hidden');
    document.getElementById('current-index-display').classList.add('hidden');
    document.getElementById('mode-title').innerText = '⏱️ 模拟考试';
    mode = 'exam';
}
