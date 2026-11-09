# User Guide — Engineering Ops v0.3

[English](#english) · [العربية](#arabic)

<a id="english"></a>
## English

### 1. First-time setup (5 minutes)

1. Open your project folder in Claude Code (Desktop app or terminal).
2. Type `/engineering-ops:engineering` and choose **1. Initial setup**.
3. Answer the questions one by one:
   - **Provider:** Trello.
   - **Connection:** if the Trello connector is connected, Claude finds your account and asks "Is this you?". If not, it shows how to create a Trello API key and token and how to save them as environment variables on your computer. **Never paste a key or token into the chat.**
   - **Boards and lists:** pick the boards and lists to watch (for example *Backlog* and *In progress*).
   - **Time zone, working days, hours:** for example Africa/Cairo, Sunday–Thursday, 10:00–19:00.
   - **Monitoring:** Claude Desktop scheduled task, `/loop` in this session, or manual only.
   - **Testing / local URLs:** optional.
   - **Language:** English by default.
4. Check the summary and say **yes** to save.

### 2. Daily use

| You want to… | Do this |
|---|---|
| See your new cards now | Menu **2** |
| Get checked every 30 minutes | Menu **3** (once) |
| Stop the checks | Menu **4** |
| Know if monitoring is working | Menu **5** |
| Understand a card before you start | Menu **6** and pick the card |
| Track your time on a task | `/engineering-ops:worklog start <card>` … `pause` … `stop` |
| Get a time report | `/engineering-ops:worklog report md` (or `csv`) |
| Add PR comments to the report | `/engineering-ops:worklog github <card>` |
| See problems and stuck work | Menu **8** |

### 3. Reading a check result

```
NEW: Fix Open filter | Product / Backlog | https://trello.com/c/… | Card check: READY
CHANGED: Export | Product / Backlog | https://trello.com/c/… | Card check: MISSING_INFO - Description, Task type (BUG or FEATURE)
```

- **NEW** — first time you see this card. **CHANGED** — its title, description, labels, due date or checklist changed. Moving a card or changing members is not a change.
- **READY** — the card has everything needed to start.
- **MISSING_INFO** — ask the card owner for the listed items before you start.
- If nothing is new, a scheduled check stays **silent**. You get **one** notification per check at most, and never the same one twice.
- `Check incomplete: …` or `BLOCKED: …` means the board could not be read fully. Nothing was marked as seen; the next check tries again.

### 4. Alerts

| Alert | Meaning | What to do |
|---|---|---|
| STUCK | A task made no progress for 60+ minutes | Resume it or stop it |
| BLOCKED | A task is waiting for something (login, data, answer) | Provide it |
| REPAIR_LIMIT | Automatic repair attempts are used up | A person decides next step |
| WATCHER_FAILED | The last board check failed | Check the connection |
| TIMER_RUNNING | A timer ran 8+ hours | Did you forget to pause? |

### 5. Working on a task with the agents (v0.2)

1. Once per project: menu **9. Workflow setup**. Claude detects your stack and test commands, and asks for branch rules and test URLs.
2. Menu **10. Run a task** (or `/engineering-ops:run-task <card link>`).
3. If your request is vague, you get a better version first (you can keep yours).
4. Choose the mode for this task:
   - **intake-only** — analysis and a handoff (code map, impact, acceptance criteria, questions). No code changes.
   - **full** — a new task branch, the change, tests, browser check, review and a final report.
5. You see the plan in one line, e.g. `Size M — analysis: sonnet, implementation: sonnet, checks: haiku, review: sonnet`. A stronger, more expensive model is only used if you approve it for one named step.
6. Claude stops and asks when it needs you: login in the browser, a product answer, a branch choice. It never commits, pushes, merges, deploys or updates cards without your permission.
7. Interrupted? Run the same card again: it continues from the last valid step.

Check a prompt any time: `/engineering-ops:refine-prompt <your request>`.

### 6. Specialist agents (v0.3) — pick the one you need

Menu items **11–16**, or call a skill directly:

| You want to know… | Run |
|---|---|
| Is the code safe? (OWASP Top 10) | `/engineering-ops:security-audit` |
| Can everyone use the pages? (keyboard, screen reader, zoom, contrast) | `/engineering-ops:accessibility-audit <page>` |
| Why is a page or action slow? | `/engineering-ops:performance-audit <page> <action>` |
| Does this feature work before release? | `/engineering-ops:ui-test <feature>` |
| Is this journey easy to use? | `/engineering-ops:ux-audit <journey>` |
| How is the system built, and what to change for my goal? | `/engineering-ops:architecture-audit <scope> <goal>` |

Every result starts with one line: **verdict · score · coverage** (`PASS`, `PASS_WITH_ISSUES`, `FAIL`, `BLOCKED`, `INSUFFICIENT_COVERAGE`). Then findings by severity (Critical → Info), each with a fix. Run the same audit again after fixing: it shows the score before and after, and which findings were fixed.

### 7. Good to know

- Monitoring and analysis never change Trello, Git or your code. Code changes happen only in **full** mode on a task branch.
- The branch guard is off until you turn it on in Workflow setup. When on, it blocks taking code from a QA branch (like `develop`) into a task branch and committing on protected branches.
- Your settings are in `~/.engineering-ops/projects/<project>/`, not in your project.
- Desktop scheduled checks need the Claude Desktop app open and the computer awake. `/loop` checks stop when the session closes.

---

<a id="arabic"></a>
<div dir="rtl">

## العربية

### ١. التجهيز لأول مرة (٥ دقايق)

1. افتح فولدر المشروع في Claude Code (تطبيق الديسكتوب أو التيرمنال).
2. اكتب `/engineering-ops:engineering` واختار **1. Initial setup**.
3. جاوب الأسئلة واحد واحد:
   - **المصدر:** Trello.
   - **الاتصال:** لو Trello connector متوصل، Claude هيلاقي حسابك ويسألك "ده إنت؟". لو مش متوصل، هيوريك إزاي تعمل API key و token وتحطهم كـ environment variables على جهازك. **عمرك ما تلزق key أو token في الشات.**
   - **البوردات والقوايم:** اختار اللي عايز تراقبه (مثلاً *Backlog* و *In progress*).
   - **المنطقة الزمنية والأيام والساعات:** مثلاً Africa/Cairo، من الأحد للخميس، من ١٠ الصبح لـ ٧ بالليل.
   - **المراقبة:** Scheduled task في تطبيق الديسكتوب، أو `/loop` في الجلسة دي، أو يدوي بس.
   - **روابط Testing و Local:** اختياري.
   - **اللغة:** English افتراضياً، وتقدر تختار العربي.
4. راجع الملخص وقول **yes** عشان يتحفظ.

### ٢. الاستخدام اليومي

| عايز… | اعمل كده |
|---|---|
| تشوف كروتك الجديدة دلوقتي | القائمة **2** |
| فحص تلقائي كل ٣٠ دقيقة | القائمة **3** (مرة واحدة) |
| توقف الفحص | القائمة **4** |
| تعرف المراقبة شغالة ولا لأ | القائمة **5** |
| تفهم كارت قبل ما تبدأ | القائمة **6** واختار الكارت |
| تحسب وقتك على تاسك | `/engineering-ops:worklog start <card>` … `pause` … `stop` |
| تقرير بالوقت | `/engineering-ops:worklog report md` (أو `csv`) |
| تضيف تعليقات الـ PR للتقرير | `/engineering-ops:worklog github <card>` |
| تشوف المشاكل والشغل الواقف | القائمة **8** |

### ٣. إزاي تقرا النتيجة

- **NEW** = أول مرة الكارت يظهر لك. **CHANGED** = العنوان أو الوصف أو الـ labels أو الميعاد أو الـ checklist اتغيروا. نقل الكارت أو تغيير الأعضاء مش تغيير.
- **READY** = الكارت فيه كل اللي محتاجه عشان تبدأ.
- **MISSING_INFO** = اسأل صاحب الكارت عن الحاجات الناقصة المكتوبة قبل ما تبدأ.
- لو مفيش جديد، الفحص المجدول **بيسكت**. هيجيلك **تنبيه واحد** بالكتير في كل فحص، ومفيش تنبيه بيتكرر.
- `Check incomplete` أو `BLOCKED` = البورد متقريش كامل. مفيش كارت اتعلّم إنه اتشاف، والفحص الجاي هيحاول تاني.

### ٤. التنبيهات

| التنبيه | معناه | تعمل إيه |
|---|---|---|
| STUCK | تاسك واقفة من غير تقدم ٦٠ دقيقة أو أكتر | كمّلها أو وقفها |
| BLOCKED | تاسك مستنية حاجة (login، بيانات، إجابة) | وفّرها |
| REPAIR_LIMIT | محاولات الإصلاح التلقائي خلصت | إنت تقرر الخطوة الجاية |
| WATCHER_FAILED | آخر فحص للبورد فشل | راجع الاتصال |
| TIMER_RUNNING | التايمر شغال ٨ ساعات أو أكتر | نسيت تعمل pause؟ |

### ٥. الشغل على تاسك مع الـ Agents (نسخة 0.2)

1. مرة واحدة لكل مشروع: القائمة **9. Workflow setup**. Claude بيتعرّف على نوع المشروع وأوامر الاختبار، ويسألك عن قواعد الـ branches وروابط الاختبار.
2. القائمة **10. Run a task** (أو `/engineering-ops:run-task <لينك الكارت>`).
3. لو طلبك مش واضح، هيقترح عليك صيغة أحسن الأول (وتقدر تفضل على صيغتك).
4. اختار الطريقة للتاسك دي:
   - **intake-only** = تحليل وتسليم (خريطة الكود، الأثر، معايير القبول، الأسئلة) من غير ما الكود يتغير.
   - **full** = branch جديد، التعديل، الاختبارات، فحص في المتصفح، مراجعة، وتقرير نهائي.
5. هتشوف الخطة في سطر واحد، زي `Size M — analysis: sonnet, implementation: sonnet, checks: haiku, review: sonnet`. الموديل الأقوى والأغلى مبيستخدمش إلا لو إنت وافقت عليه لخطوة واحدة محددة.
6. Claude بيقف ويسألك لما يحتاجك: login في المتصفح، إجابة من صاحب المنتج، أو اختيار branch. عمره ما بيعمل commit أو push أو merge أو deploy أو يحدّث كارت من غير إذنك.
7. الشغل اتقطع؟ شغّل نفس الكارت تاني، وهيكمّل من آخر خطوة سليمة.

تقدر تراجع أي برومبت في أي وقت: `/engineering-ops:refine-prompt <طلبك>`.

### ٦. الوكلاء المتخصصين (نسخة 0.3): اختار اللي محتاجه

القائمة من **11 لـ 16**، أو شغّل الـ skill مباشرة:

| عايز تعرف… | شغّل |
|---|---|
| الكود آمن؟ (OWASP Top 10) | `/engineering-ops:security-audit` |
| الصفحات ينفع يستخدمها أي حد؟ (كيبورد، قارئ شاشة، تكبير، تباين ألوان) | `/engineering-ops:accessibility-audit <الصفحة>` |
| ليه الصفحة أو الحركة دي بطيئة؟ | `/engineering-ops:performance-audit <الصفحة> <الحركة>` |
| الميزة شغالة قبل ما ننزلها؟ | `/engineering-ops:ui-test <الميزة>` |
| الرحلة دي سهلة على المستخدم؟ | `/engineering-ops:ux-audit <الرحلة>` |
| النظام مبني إزاي، وأغيّر إيه عشان هدفي؟ | `/engineering-ops:architecture-audit <النطاق> <الهدف>` |

كل نتيجة بتبدأ بسطر واحد: **الحكم · الدرجة · التغطية** (`PASS` أو `PASS_WITH_ISSUES` أو `FAIL` أو `BLOCKED` أو `INSUFFICIENT_COVERAGE`). بعدها المشاكل مترتبة حسب الخطورة من Critical لـ Info، وكل مشكلة معاها طريقة حلها. لو شغّلت نفس الفحص تاني بعد ما تصلّح، هيوريك الدرجة قبل وبعد، وأنهي مشاكل اتحلت.

### ٧. معلومات مهمة

- المراقبة والتحليل عمرهم ما بيغيروا حاجة في Trello أو Git أو الكود. تعديل الكود بيحصل بس في **full** على task branch.
- الـ branch guard مقفول لحد ما تفعّله من Workflow setup. لما يتفعّل، بيمنع إن كود من branch الـ QA (زي `develop`) يدخل في task branch، وبيمنع الـ commit على الـ branches المحمية.
- إعداداتك محفوظة في `~/.engineering-ops/projects/<project>/` مش جوه المشروع.
- الفحص المجدول في الديسكتوب محتاج التطبيق مفتوح والجهاز صاحي. فحص `/loop` بيقف لما الجلسة تتقفل.

</div>
