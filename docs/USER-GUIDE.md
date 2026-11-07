# User Guide — Engineering Ops v0.1

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

### 5. Good to know

- v0.1 never changes Trello, Git or your code.
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

### ٥. معلومات مهمة

- النسخة 0.1 عمرها ما بتغيّر حاجة في Trello أو Git أو الكود.
- إعداداتك محفوظة في `~/.engineering-ops/projects/<project>/` مش جوه المشروع.
- الفحص المجدول في الديسكتوب محتاج التطبيق مفتوح والجهاز صاحي. فحص `/loop` بيقف لما الجلسة تتقفل.

</div>
