# Osh Language CRM

Локальный React-проект на Vite. Учёт студентов языкового центра по группам: пайплайна лидов больше нет (его ведут менеджеры в AmoCRM) — вместо него учёт групп, студентов и истории оплат, плюс CFO-аналитика с графиками (Recharts). Данные хранятся в общем Supabase-проекте — все пользователи видят одну и ту же базу.

## Запуск

```bash
npm install
npm run dev
```

Откроется на http://localhost:5173/.

## Supabase

Ключи лежат в `.env` (не коммитится, см. `.gitignore`):

```
VITE_SUPABASE_URL=https://vynmnzbzuapdkhkuyauk.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

Клиент — [src/supabaseClient.js](src/supabaseClient.js).

Перед первым запуском в этом Supabase-проекте нужно один раз выполнить в SQL Editor:

1. [supabase/schema.sql](supabase/schema.sql) — создаёт таблицы `groups`, `students`, `payments`, `managers`, `teachers`, `activity_log` + RLS-политики (открытые для anon-ключа — эти таблицы не разграничены по пользователю, доступ по роли проверяется на клиенте).
2. [supabase/seed.sql](supabase/seed.sql) — переносит текущие 25 групп / 346 студентов / 334 платежа / 5 менеджеров / 15 преподавателей (сгенерирован из бывших `src/seed-groups.js` / `src/seed-students.js`). Можно пропустить, если нужна пустая база.
3. [supabase/migration_finance.sql](supabase/migration_finance.sql) — добавляет revenue-recognition поля к `payments`, таблицы `expense_categories`/`expenses`/`revenue_adjustments` для вкладки «Финансы». Без него вкладка «Финансы» не откроется (в консоли будут ошибки `Could not find the table`), но остальной CRM (Группы, CFO, Моя аналитика) работает и без этой миграции — она нужна только под P&L-модуль.
4. [supabase/migration_auth.sql](supabase/migration_auth.sql) — создаёт таблицу `profiles`, которая связывает настоящего Supabase Auth пользователя с ролью/именем менеджера в этом приложении. См. раздел «Аутентификация» ниже — без неё экран входа пустит по email/паролю в Supabase Auth, но приложение не поймёт, кто это и какая у него роль.

## Аутентификация

Вход — это настоящий Supabase Auth (`supabase.auth.signInWithPassword`), без своего бэкенда для паролей. Как завести пользователя:

1. **Dashboard → Authentication → Users → Add user** — вручную создать email + пароль для каждого менеджера и для себя (супер-админа). Скопировать **User UID** созданного пользователя.
2. В **SQL Editor** добавить строку в `profiles` с этим UID (см. примеры в конце [migration_auth.sql](supabase/migration_auth.sql)):
   ```sql
   insert into public.profiles (id, role, manager_name) values
     ('<uid-из-authentication>', 'manager', 'Диана');
   ```
   Для супер-админа `role = 'admin'`, `manager_name = null`.
3. **Сменить пароль позже**: Dashboard → Authentication → Users → выбрать пользователя → «...» → **Reset password** (или **Send magic link**) — встроенная функция Supabase, ничего в коде для этого делать не нужно.

Сессию (токен, обновление, хранение) полностью ведёт `supabase-js` сам — приложение больше ничего не пишет в localStorage под это.

## Деплой (Vercel)

Проект деплоится на Vercel через их git-интеграцию — отдельного workflow-файла в репозитории для этого нет, Vercel сам собирает Vite-проект при каждом push в `main`.

Настройка (один раз, в дашборде Vercel):

1. Import Project → выбрать этот GitHub-репозиторий. Framework Preset определится как **Vite** автоматически (build command `npm run build`, output directory `dist`).
2. В Project Settings → Environment Variables добавить те же два ключа, что в `.env` локально: `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`.
3. Deploy — дальше каждый push в `main` пересобирает и выкатывает автоматически.

## Модель данных

- **Группа** (`groups`): id, level, name, teacher, time, max_size (15), status active/archived, notes.
- **Студент** (`students`): id, name, phone, level, group_id (FK), manager, contract_amount, status active/archived, notes.
- **Платёж** (`payments`): id, student_id (FK), amount, date, note — раньше жил встроенным массивом в студенте, теперь отдельная таблица, платежи джойнятся к студенту на клиенте при загрузке. `totalPaid`/`remaining` вычисляются на лету, не хранятся.
- **Менеджеры/преподаватели** (`managers`/`teachers`): простой список уникальных имён.
- **Журнал изменений** (`activity_log`): последние 500 записей `{id, timestamp, actor, action, entity_type, entity_id}` — создаётся автоматически при любом изменении студента/группы.
- **Профиль пользователя** (`profiles`): `{ id (= auth.users.id), role: "admin" | "manager", manager_name }` — единственная таблица с реальным RLS (каждый видит только свою строку). Заполняется вручную в SQL Editor после создания пользователя в Supabase Auth.

## Роли

- **Супер-админ (CFO)** — видит всё: все группы, все студенты, вкладки «CFO — аналитика», «Финансы» и «Журнал изменений», может удалять платежи. На вкладке CFO есть выпадающий список «Показать аналитику менеджера» — выбор конкретного менеджера подменяет агрегатный вид тем же дашбордом, что видит сам менеджер на «Моя аналитика» (компонент `ManagerAnalyticsView` переиспользуется, просто с другим `managerName`).
- **Менеджер** — видит все группы, но внутри них только своих студентов (`student.manager === session.name`); вместо CFO/Финансы/Журнал изменений видит одну персональную вкладку «Моя аналитика» (KPI за выбранный месяц с сравнением к предыдущему, тренд выручки, разбивка по уровням/группам) — тоже только по своим студентам; при добавлении студента автоматически становится его менеджером; не может удалять платежи.

Кнопка «Выйти / сменить пользователя» внизу сайдбара вызывает `supabase.auth.signOut()` и возвращает на экран входа.

## Структура

- `src/crm-prototype.jsx` — основной компонент CRM (Группы, профиль студента, CFO-аналитика, журнал изменений)
- `src/supabaseClient.js` — инициализация Supabase-клиента
- `supabase/schema.sql`, `supabase/seed.sql`, `supabase/migration_finance.sql`, `supabase/migration_auth.sql` — SQL-миграции и перенос исходных данных
- `src/seed-groups.js`, `src/seed-students.js` — исходники, из которых сгенерирован `seed.sql` (в рантайме больше не используются)
- `src/App.jsx` — точка входа, подключает CRM
- `Intensive__1_.xlsx` — исходная таблица, из которой изначально были собраны данные студентов
