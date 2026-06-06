import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { readNewsReport } from './lib/news.mjs'

const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '127.0.0.1'
const ENV_FILE = join(homedir(), '.config', 'wallace', 'airtable.env')
const execFileAsync = promisify(execFile)

const SOURCES = {
  work: {
    name: 'Proposal Submissions Master',
    baseId: 'appa5YzSgQrCnNAkV',
    tables: {
      proposals: { name: 'Proposals', id: 'tbl8ValM1IxO4aVvy' },
    },
  },
  wallace: {
    name: "Wallace's Base",
    baseId: 'appKcxKmGlMy2Wvmb',
    tables: {
      acquisitions: { name: 'Acquisitions', id: 'tbl3Uif6aeqUKiIjn' },
      tenders: { name: 'Tenders', id: 'tblFovU5j95DlLA6o' },
    },
  },
}

async function readToken() {
  const body = await readFile(ENV_FILE, 'utf8')
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^AIRTABLE_TOKEN=(.*)$/)
    if (!match) continue
    return match[1].replace(/^['"]|['"]$/g, '').trim()
  }
  throw new Error('AIRTABLE_TOKEN is missing from the local env file.')
}

async function airtableFetch(token, path, params = {}) {
  const url = new URL(`https://api.airtable.com/v0/${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : {}

  if (!response.ok) {
    const type = data?.error?.type || 'airtable_error'
    const message = data?.error?.message || response.statusText
    throw new Error(`${type}: ${message}`)
  }

  return data
}

async function listRecords(token, baseId, tableId) {
  const records = []
  let offset

  do {
    const data = await airtableFetch(token, `${baseId}/${tableId}`, {
      pageSize: 100,
      offset,
    })
    records.push(...(data.records || []))
    offset = data.offset
  } while (offset)

  return records.map((record) => ({
    id: record.id,
    createdTime: record.createdTime,
    fields: record.fields || {},
  }))
}

async function buildDashboard() {
  const token = await readToken()
  const [proposals, acquisitions, tenders, usage] = await Promise.all([
    listRecords(token, SOURCES.work.baseId, SOURCES.work.tables.proposals.id),
    listRecords(token, SOURCES.wallace.baseId, SOURCES.wallace.tables.acquisitions.id),
    listRecords(token, SOURCES.wallace.baseId, SOURCES.wallace.tables.tenders.id),
    readModelUsage(),
  ])
  const news = await readNewsReport()

  return {
    generatedAt: new Date().toISOString(),
    sources: SOURCES,
    usage,
    news,
    tables: {
      proposals,
      acquisitions,
      tenders,
    },
  }
}

async function readModelUsage() {
  const script = '/opt/homebrew/lib/node_modules/openclaw/skills/model-usage/scripts/model_usage.py'

  try {
    const { stdout } = await execFileAsync('python3', [
      script,
      '--provider',
      'codex',
      '--mode',
      'all',
      '--format',
      'json',
    ])
    return JSON.parse(stdout)
  } catch (error) {
    return {
      error: 'model_usage_unavailable',
      message: error instanceof Error ? error.message : 'Unable to read local usage logs',
    }
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
  })
  response.end(JSON.stringify(payload))
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
    })
    response.end()
    return
  }

  const url = new URL(request.url || '/', `http://${request.headers.host}`)

  try {
    if (url.pathname === '/api/health') {
      sendJson(response, 200, { ok: true })
      return
    }

    if (url.pathname === '/api/dashboard') {
      sendJson(response, 200, await buildDashboard())
      return
    }

    sendJson(response, 404, { error: 'not_found' })
  } catch (error) {
    sendJson(response, 500, {
      error: 'dashboard_api_failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`Wallace dashboard API listening on http://${HOST}:${PORT}`)
})
