# Yopem Auth

A TypeScript authentication service that runs on [Bun](https://bun.com).
[OpenAuth](https://openauth.js.org) handles Google OAuth sign-in. PostgreSQL
stores users and OpenAuth data through [Drizzle ORM](https://orm.drizzle.team).
[Zod](https://zod.dev) validates configuration and Google user data.

## Getting Started

### Prerequisites

- Bun `1.4.4-canary.1`
- A PostgreSQL database
- A Google Cloud project with an OAuth 2.0 web application client

### Installation

```bash
git clone https://github.com/yopem/auth.git
cd auth
bun install --frozen-lockfile
```

### Configuration

1. Copy `.env.example` to `.env`. Set `DATABASE_URL`, `GOOGLE_CLIENT_ID`, and
   `GOOGLE_CLIENT_SECRET`. Set `PORT=3999` for the examples below.
2. In Google Cloud, add `http://localhost:3999/google/callback` as an authorized
   redirect URI for local development. For production, add
   `https://your-domain/google/callback` with your public domain.
3. Apply the existing database migrations:

   ```bash
   bun run db:migrate
   ```

   If you change the database schema, run `bun run db:generate` to create a
   migration before you apply it.

### Run the Application

```bash
bun run dev
```

With `PORT=3999`, the service listens at `http://localhost:3999`.

### Deploy

Set the production environment variables and apply the database migrations
before you start the service. To build and run the standalone executable:

```bash
bun run build
bun run start
```

Build the Docker image before you create `.env`, or build from a clean checkout.
The Dockerfile copies the build directory. Do not include secrets in it.

```bash
docker build -t yopem-auth .
```

Run the container from the repository root with your `.env` file. Set
`DATABASE_URL` to a database address that the container can reach.

```bash
docker run --rm --env-file .env -e PORT=3999 -p 3999:3999 yopem-auth
```

## License

[AGPL-3.0-or-later](LICENSE.md)
