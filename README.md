# AskUp

AskUp is a real-time classroom question platform. Students join a lecture with a short code and ask anonymously, while professors receive and manage questions live.

## Features

- Separate student and professor interfaces
- Professor-created sessions with simple five-digit join codes
- Multiple simultaneous professor sessions with isolated question queues
- Real-time questions with one vote per browser per question
- Strict lecture-topic moderation with no student override, while exam, assignment, and project questions remain allowed
- Student-owned question deletion using the browser's anonymous private ID
- No-login anonymous student access and professor email validation
- Client- and server-side English and Arabic foul-language blocking
- Optional PDF, PowerPoint, or Word lecture-material analysis with personal-question blocking and course-logistics exceptions
- Completed-session history

## Run locally

Requires Node.js.

```powershell
node server.js
```

Open:

- Professor: `http://localhost:4173/professor`
- Student: `http://localhost:4173/student`

For classroom testing on the same Wi-Fi, replace `localhost` with the host laptop's local IPv4 address and keep the server running.

## Test

```powershell
node --test server.test.js
```
