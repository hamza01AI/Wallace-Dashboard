import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readNewsReport } from '../lib/news.mjs'

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

function sendJson(response, status, payload) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('access-control-allow-origin', '*')
  response.setHeader('access-control-allow-methods', 'GET, OPTIONS')
  response.setHeader('access-control-allow-headers', 'content-type')
  response.end(JSON.stringify(payload))
}

function getToken() {
  const token = process.env.AIRTABLE_TOKEN?.trim()
  if (token) return token

  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    throw new Error('AIRTABLE_TOKEN is not set in Vercel.')
  }

  const envFile = join(homedir(), '.config', 'wallace', 'airtable.env')
  return readFile(envFile, 'utf8')
    .then((body) => {
      for (const rawLine of body.split(/\r?\n/)) {
        const line = rawLine.trim()
        if (!line || line.startsWith('#')) continue
        const match = line.match(/^AIRTABLE_TOKEN=(.*)$/)
        if (!match) continue
        return match[1].replace(/^['"]|['"]$/g, '').trim()
      }
      throw new Error('AIRTABLE_TOKEN is missing.')
    })
    .catch((error) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new Error('AIRTABLE_TOKEN is missing. Set it locally or in Vercel.')
      }
      throw error
    })
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
  const token = await getToken()
  const [proposals, acquisitions, tenders] = await Promise.all([
    listRecords(token, SOURCES.work.baseId, SOURCES.work.tables.proposals.id),
    listRecords(token, SOURCES.wallace.baseId, SOURCES.wallace.tables.acquisitions.id),
    listRecords(token, SOURCES.wallace.baseId, SOURCES.wallace.tables.tenders.id),
  ])
  const news = await readNewsReport()

  return {
    generatedAt: new Date().toISOString(),
    sources: SOURCES,
    usage: {
      error: 'model_usage_unavailable',
      message: 'Local model usage logs are not available in Vercel functions.',
    },
    news,
    tables: {
      proposals,
      acquisitions,
      tenders,
    },
  }
}

export default async function handler(request, response) {
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {})
    return
  }

  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'method_not_allowed' })
    return
  }

  try {
    sendJson(response, 200, await buildDashboard())
  } catch (error) {
    sendJson(response, 500, {
      error: 'dashboard_api_failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
