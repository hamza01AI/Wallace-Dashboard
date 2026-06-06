import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const NEWS_REPORT_PATH = join(process.cwd(), 'data', 'news', 'latest.json')

export async function readNewsReport() {
  try {
    const body = await readFile(NEWS_REPORT_PATH, 'utf8')
    return JSON.parse(body)
  } catch {
    return null
  }
}
