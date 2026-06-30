import 'dotenv/config'
import { Client } from 'pg'

export function createPostgresClient() {
  const connectionString = process.env.DATABASE_URL?.trim()

  if (!connectionString) {
    throw new Error('Set DATABASE_URL in .env before running database scripts.')
  }

  return new Client({ connectionString })
}

export async function withPostgresClient<T>(
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const client = createPostgresClient()

  await client.connect()
  try {
    return await work(client)
  } finally {
    await client.end()
  }
}
