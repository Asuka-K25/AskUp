# AskUp

AskUp is a real-time classroom question platform. Students join a lecture with a short code and ask anonymously, while professors receive and manage questions live.

## Features

- Separate student and professor interfaces
- Professor-created sessions with random join codes
- Real-time questions, upvotes, and answer status
- Student ID and professor email validation
- Client- and server-side foul-language blocking
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
