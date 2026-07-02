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

1. [supabase/schema.sql](supabase/schema.sql) — создаёт таблицы `groups`, `students`, `payments`, `managers`, `teachers`, `activity_log` + RLS-политики (открытые для anon-ключа, т.к. в приложении нет настоящей Supabase Auth).
2. [supabase/seed.sql](supabase/seed.sql) — переносит текущие 25 групп / 346 студентов / 334 платежа / 5 менеджеров / 15 преподавателей (сгенерирован из бывших `src/seed-groups.js` / `src/seed-students.js`). Можно пропустить, если нужна пустая база.

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
- **Сессия** (`crm-session`, localStorage): `{ role: "admin" | "manager", name }` — простой выбор роли на экране входа, без реального пароля/бэкенда. Это единственное, что осталось в localStorage — оно про конкретный браузер, а не общие данные.

## Роли

- **Супер-админ (CFO)** — видит всё: все группы, все студенты, вкладки «CFO — аналитика» и «Журнал изменений», может удалять платежи.
- **Менеджер** — видит все группы, но внутри них только своих студентов (`student.manager === session.name`); не видит вкладки CFO и «Журнал изменений»; при добавлении студента автоматически становится его менеджером; не может удалять платежи.

Кнопка «Выйти / сменить пользователя» внизу сайдбара сбрасывает сессию и возвращает на экран выбора роли.

## Структура

- `src/crm-prototype.jsx` — основной компонент CRM (Группы, профиль студента, CFO-аналитика, журнал изменений)
- `src/supabaseClient.js` — инициализация Supabase-клиента
- `supabase/schema.sql`, `supabase/seed.sql` — SQL-миграция и перенос исходных данных
- `src/seed-groups.js`, `src/seed-students.js` — исходники, из которых сгенерирован `seed.sql` (в рантайме больше не используются)
- `src/App.jsx` — точка входа, подключает CRM
- `Intensive__1_.xlsx` — исходная таблица, из которой изначально были собраны данные студентов
