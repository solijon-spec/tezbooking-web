'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const { COUNTRY_RU } = require('../live/samo');
const { validDate, FROM_IDS } = require('../live/validation');
const { INITIAL_SETTINGS, initialSites } = require('./registry');
const { normalizeOffer, compareOffers } = require('./normalize');
const { TASK_TRANSITIONS, EXECUTION_TRANSITIONS, canTransition } = require('./state');

const CURRENCIES = new Set(['USD', 'EUR', 'UZS']);
const MEALS = new Set(['RO', 'BB', 'HB', 'FB', 'AI', 'UAI']);
const SITE_TYPES = new Set(['samo', 'b2b', 'api', 'other']);

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function json(value, fallback) {
  try { return JSON.parse(value); } catch (error) { return fallback; }
}

function parseWebsiteUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash
      || !url.hostname.includes('.') || ['localhost', 'localhost.localdomain'].includes(url.hostname.toLowerCase())) return null;
    return url.href;
  } catch (error) { return null; }
}

function validateSearchParameters(input, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const destination = typeof input.destination === 'string' ? input.destination.trim() : '';
  const country = typeof input.country === 'string' ? input.country.trim().toLowerCase() : '';
  const date = typeof input.date === 'string' ? input.date : '';
  const adults = Number(input.adults);
  let nights = Number(input.nights);
  // Qaytish sanasi (ixtiyoriy, sayt filtri bilan bir xil): berilsa — tunlar soni shundan (qaytish − uchish)
  const returnDate = input.returnDate === undefined || input.returnDate === null || input.returnDate === '' ? null : String(input.returnDate);
  if (returnDate !== null) {
    if (!validDate(returnDate) || !validDate(date) || returnDate <= date) return null;
    nights = Math.round((Date.parse(returnDate + 'T00:00:00Z') - Date.parse(date + 'T00:00:00Z')) / 86400000);
  }
  const childrenAges = input.childrenAges === undefined ? [] : input.childrenAges;
  const today = new Date(now()).toISOString().slice(0, 10);
  if (!destination || destination.length > 120 || !Object.prototype.hasOwnProperty.call(COUNTRY_RU, country)
    || !validDate(date) || date < today || date > new Date(Date.parse(today + 'T00:00:00Z') + 365 * 86400000).toISOString().slice(0, 10)
    || !Number.isInteger(adults) || adults < 1 || adults > 8 || !Number.isInteger(nights) || nights < 1 || nights > 30
    || !Array.isArray(childrenAges) || childrenAges.length > 4
    || childrenAges.some(age => !Number.isInteger(age) || age < 0 || age > 17)) return null;

  const budget = input.budget === undefined || input.budget === null || input.budget === '' ? null : Number(input.budget);
  if (budget !== null && (!Number.isFinite(budget) || budget <= 0 || budget > 100000000)) return null;
  const currency = String(input.currency || 'USD').toUpperCase();
  if (!CURRENCIES.has(currency)) return null;
  const stars = input.hotelStars === undefined || input.hotelStars === null || input.hotelStars === '' ? null : Number(input.hotelStars);
  if (stars !== null && (!Number.isInteger(stars) || stars < 1 || stars > 5)) return null;
  const mealPlan = input.mealPlan ? String(input.mealPlan).toUpperCase() : null;
  if (mealPlan && !MEALS.has(mealPlan)) return null;
  const departureAirport = input.departureAirport === undefined || input.departureAirport === null || input.departureAirport === ''
    ? null
    : FROM_IDS.includes(input.departureAirport) ? input.departureAirport : false;
  if (departureAirport === false) return null;
  // Mehmonxona nomi (ixtiyoriy): "CAMIA RESORT" — ishchilar faqat shu mehmonxonaning paketlarini qaytaradi
  const hotelName = input.hotelName === undefined || input.hotelName === null ? ''
    : typeof input.hotelName === 'string' ? input.hotelName.replace(/\s+/g, ' ').trim() : false;
  if (hotelName === false || hotelName.length > 80) return null;

  return {
    destination,
    country,
    date,
    nights,
    ...(returnDate ? { returnDate } : {}),
    adults,
    childrenAges: childrenAges.slice(),
    budget,
    currency,
    hotelStars: stars,
    mealPlan,
    departureAirport,
    hotelName: hotelName || null
  };
}

function createOwnerService({ db, now = Date.now, emit = () => {} }) {
  const raw = db.raw;
  const run = (sql, ...args) => raw.prepare(sql).run(...args);
  const get = (sql, ...args) => raw.prepare(sql).get(...args);
  const all = (sql, ...args) => raw.prepare(sql).all(...args);

  function transaction(fn) {
    raw.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      raw.exec('COMMIT');
      return result;
    } catch (error) {
      raw.exec('ROLLBACK');
      throw error;
    }
  }

  function activity(eventType, message, severity = 'info', details = {}) {
    run('INSERT INTO activities (event_type, severity, message, details_json, created_at) VALUES (?, ?, ?, ?, ?)',
      eventType, severity, message, JSON.stringify(details), now());
    emit({ type: eventType, severity });
  }

  function alert(alertType, severity, message) {
    const id = crypto.randomUUID();
    run('INSERT INTO system_alerts (id, alert_type, severity, message, created_at) VALUES (?, ?, ?, ?, ?)',
      id, alertType, severity, message, now());
    emit({ type: 'alert', severity });
    return id;
  }

  function websiteView(row) {
    return {
      id: row.id, workerId: row.worker_id, name: row.name, url: row.url, loginUrl: row.login_url,
      searchUrl: row.search_url, websiteType: row.website_type, enabled: !!row.enabled,
      integrationStatus: row.integration_status, authStatus: row.auth_status, workerStatus: row.worker_status,
      customInstructions: row.custom_instructions, fieldMappings: json(row.field_mappings_json, {}),
      lastSuccessfulLogin: row.last_successful_login, lastSuccessfulSearch: row.last_successful_search,
      lastError: row.last_error, createdAt: row.created_at, updatedAt: row.updated_at
    };
  }

  function taskView(row) {
    const settled = get(`SELECT COUNT(*) AS n FROM worker_executions
      WHERE task_id = ? AND status IN ('completed', 'failed', 'blocked', 'cancelled')`, row.id).n;
    return {
      id: row.id, command: row.command, parameters: json(row.parameters_json, {}),
      status: row.status, totalWorkers: row.total_workers, completedWorkers: row.completed_workers,
      failedWorkers: row.failed_workers, offersFound: row.offers_found, aggregationStatus: row.aggregation_status,
      errorCode: row.error_code, createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at,
      progressPercent: row.total_workers ? Math.round((settled / row.total_workers) * 100) : 0
    };
  }

  function executionView(row) {
    return {
      id: row.id, taskId: row.task_id, websiteId: row.website_id, workerId: row.worker_id,
      status: row.status, attempts: row.attempts, offersFound: row.offers_found, errorCode: row.error_code,
      idempotencyKey: row.idempotency_key || null, leaseUntil: row.lease_until || null,
      heartbeatAt: row.heartbeat_at || null,
      queuedAt: row.queued_at, startedAt: row.started_at, finishedAt: row.finished_at
    };
  }

  function executionEvent(executionId, taskId, attempt, eventType, message, errorCode = null, details = {}) {
    run(`INSERT INTO worker_execution_events
      (execution_id, task_id, attempt, event_type, error_code, message, details_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    executionId, taskId, attempt, eventType, errorCode, message, JSON.stringify(details), now());
    emit({ type: 'worker_' + eventType, taskId, executionId });
  }

  for (const site of initialSites()) {
    run(`INSERT OR IGNORE INTO websites
      (id, worker_id, name, url, login_url, search_url, website_type, enabled, integration_status, auth_status,
       worker_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'pending', 'not_configured', 'pending', ?, ?)`,
    site.id, site.workerId, site.name, site.url, site.loginUrl, site.searchUrl, site.websiteType, now(), now());
  }
  for (const [key, value] of Object.entries(INITIAL_SETTINGS)) {
    run('INSERT OR IGNORE INTO system_settings (key, value_json, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(value), now());
  }

  function listWebsites() {
    return all('SELECT * FROM websites ORDER BY name COLLATE NOCASE').map(websiteView);
  }

  function createWebsite(input) {
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, 120) : '';
    const url = parseWebsiteUrl(input.url);
    const loginUrl = parseWebsiteUrl(input.loginUrl || input.url);
    const searchUrl = parseWebsiteUrl(input.searchUrl || input.url);
    const websiteType = SITE_TYPES.has(input.websiteType) ? input.websiteType : 'other';
    const customInstructions = typeof input.customInstructions === 'string' ? input.customInstructions.trim().slice(0, 2000) : '';
    if (!name || !url || !loginUrl || !searchUrl) return { error: 'bad_website' };
    const existing = all('SELECT url FROM websites').some(row => row.url.replace(/\/+$/, '') === url.replace(/\/+$/, ''));
    if (existing) return { error: 'duplicate_website' };
    const id = crypto.randomUUID();
    const workerId = 'worker_' + id;
    const time = now();
    run(`INSERT INTO websites
      (id, worker_id, name, url, login_url, search_url, website_type, enabled, integration_status, auth_status,
       worker_status, custom_instructions, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'pending', 'not_configured', 'pending', ?, ?, ?)`,
    id, workerId, name, url, loginUrl, searchUrl, websiteType, customInstructions, time, time);
    activity('website_added', 'Website configuration added and marked pending.', 'info', { websiteId: id });
    return { website: websiteView(get('SELECT * FROM websites WHERE id = ?', id)) };
  }

  function updateWebsite(id, input) {
    const current = get('SELECT * FROM websites WHERE id = ?', id);
    if (!current) return null;
    const name = input.name === undefined ? current.name : String(input.name).trim().slice(0, 120);
    const url = input.url === undefined ? current.url : parseWebsiteUrl(input.url);
    const loginUrl = input.loginUrl === undefined ? current.login_url : parseWebsiteUrl(input.loginUrl);
    const searchUrl = input.searchUrl === undefined ? current.search_url : parseWebsiteUrl(input.searchUrl);
    const websiteType = input.websiteType === undefined ? current.website_type : input.websiteType;
    const enabled = input.enabled === undefined ? !!current.enabled : input.enabled;
    const customInstructions = input.customInstructions === undefined
      ? current.custom_instructions : String(input.customInstructions).trim().slice(0, 2000);
    if (!name || !url || !loginUrl || !searchUrl || !SITE_TYPES.has(websiteType) || typeof enabled !== 'boolean') return false;
    if (all('SELECT id, url FROM websites WHERE id != ?', id).some(row => row.url.replace(/\/+$/, '') === url.replace(/\/+$/, ''))) return false;
    run(`UPDATE websites SET name = ?, url = ?, login_url = ?, search_url = ?, website_type = ?,
      enabled = ?, custom_instructions = ?, updated_at = ? WHERE id = ?`,
    name, url, loginUrl, searchUrl, websiteType, enabled ? 1 : 0, customInstructions, now(), id);
    activity('website_updated', 'Website configuration updated; integration remains pending.', 'info', { websiteId: id });
    return websiteView(get('SELECT * FROM websites WHERE id = ?', id));
  }

  // Ishchisi (adapter) serverda o'rnatilgan operator: "tasdiqlangan" va "tayyor" holatiga o'tadi.
  // Faqat server ishga tushganda, kodda ro'yxatdan o'tgan ishchilar uchun chaqiriladi (foydalanuvchi so'rovi bilan emas).
  function markWorkerConnected(id, websiteType) {
    const row = get('SELECT integration_status, worker_status, website_type FROM websites WHERE id = ?', id);
    if (!row || !SITE_TYPES.has(websiteType)) return false;
    if (row.integration_status === 'verified' && row.website_type === websiteType && row.worker_status !== 'pending') return true;
    run(`UPDATE websites SET integration_status = 'verified', website_type = ?,
      worker_status = CASE WHEN worker_status = 'pending' THEN 'idle' ELSE worker_status END, updated_at = ? WHERE id = ?`,
    websiteType, now(), id);
    activity('website_connected', 'Operator worker registered; integration marked verified.', 'info', { websiteId: id, websiteType });
    return true;
  }

  // Operator kabinetiga kirish holati (ishchi xabar beradi; login/parol bazaga yozilmaydi, faqat holat):
  //   none — login berilmagan (ochiq sahifa), pending — login bor, hali kirilmagan,
  //   authenticated — kirildi (at — kirish vaqti), failed — parol qabul qilinmadi yoki kabinet ochilmadi
  const AUTH_STATUS = { none: 'not_configured', pending: 'required', authenticated: 'authenticated', failed: 'manual_action' };
  function markAuthStatus(id, status, { at, error } = {}) {
    const next = AUTH_STATUS[status];
    const row = next && get('SELECT name, auth_status, last_successful_login FROM websites WHERE id = ?', id);
    if (!row) return false;
    const loginAt = next === 'authenticated' && Number.isFinite(at) ? at : null;
    if (row.auth_status === next && (!loginAt || row.last_successful_login === loginAt)) return true;
    if (loginAt) run('UPDATE websites SET auth_status = ?, last_successful_login = ?, updated_at = ? WHERE id = ?', next, loginAt, now(), id);
    else run('UPDATE websites SET auth_status = ?, updated_at = ? WHERE id = ?', next, now(), id);
    if (row.auth_status === next) return true;
    if (next === 'authenticated') {
      activity('website_authenticated', 'Logged in to the operator agency account.', 'info', { websiteId: id });
    } else if (next === 'manual_action') {
      const code = error === 'auth_unavailable' ? 'auth_unavailable' : 'auth_failed';
      activity('website_auth_failed', 'Operator login failed; the worker searches the public page instead.', 'warning', { websiteId: id, error: code });
      if (code === 'auth_failed') alert('website_auth_failed', 'warning', 'Login to ' + row.name + ' was not accepted. Check the operator login in .env.');
    }
    return true;
  }

  function settings() {
    return Object.fromEntries(all('SELECT key, value_json FROM system_settings').map(row => [row.key, json(row.value_json, null)]));
  }

  function updateSettings(input) {
    const current = settings();
    const next = {
      worker_concurrency: input.workerConcurrency === undefined ? current.worker_concurrency : input.workerConcurrency,
      per_operator_concurrency: input.perOperatorConcurrency === undefined ? current.per_operator_concurrency : input.perOperatorConcurrency,
      retry_limit: input.retryLimit === undefined ? current.retry_limit : input.retryLimit,
      search_timeout_seconds: input.searchTimeoutSeconds === undefined ? current.search_timeout_seconds : input.searchTimeoutSeconds,
      retention_days: input.retentionDays === undefined ? current.retention_days : input.retentionDays
    };
    if (!Number.isInteger(next.worker_concurrency) || next.worker_concurrency < 1 || next.worker_concurrency > 50
      || !Number.isInteger(next.per_operator_concurrency) || next.per_operator_concurrency < 1 || next.per_operator_concurrency > 10
      || !Number.isInteger(next.retry_limit) || next.retry_limit < 0 || next.retry_limit > 5
      || !Number.isInteger(next.search_timeout_seconds) || next.search_timeout_seconds < 5 || next.search_timeout_seconds > 300
      || !Number.isInteger(next.retention_days) || next.retention_days < 1 || next.retention_days > 365) return null;
    transaction(() => {
      Object.entries(next).forEach(([key, value]) => {
        run('INSERT INTO system_settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at',
          key, JSON.stringify(value), now());
      });
      activity('settings_updated', 'Owner system settings updated.');
    });
    return settings();
  }

  function createSearch(input, selectedWebsiteIds = null, idempotencyKey = null) {
    const parameters = validateSearchParameters(input.parameters, now);
    if (!parameters) return { error: 'bad_search_parameters' };
    const command = typeof input.command === 'string' && input.command.trim()
      ? input.command.trim().slice(0, 1000)
      : `${parameters.destination}, ${parameters.adults} adults, ${parameters.nights} nights, ${parameters.date}`;
    const key = idempotencyKey == null ? null : String(idempotencyKey).trim();
    if (key !== null && (!key || key.length > 128 || !/^[a-zA-Z0-9._:-]+$/.test(key))) return { error: 'bad_idempotency_key' };
    const requestHash = hash(JSON.stringify({ command, parameters }));
    if (key) {
      const previous = get('SELECT id, request_hash FROM search_tasks WHERE idempotency_key = ?', key);
      if (previous) {
        return previous.request_hash === requestHash
          ? { task: getTask(previous.id), duplicate: true }
          : { error: 'idempotency_conflict' };
      }
    }

    const enabledWebsites = all('SELECT * FROM websites WHERE enabled = 1 ORDER BY name COLLATE NOCASE');
    const selected = Array.isArray(selectedWebsiteIds)
      ? new Set(selectedWebsiteIds)
      : null;
    const websites = selected === null
      ? enabledWebsites
      : enabledWebsites.filter(site => selected.has(site.id) && site.integration_status === 'verified');
    const queued = selected !== null && websites.length > 0;
    const id = crypto.randomUUID();
    const time = now();
    const errorCode = queued ? null : enabledWebsites.length ? 'no_verified_adapters' : 'no_enabled_sources';
    transaction(() => {
      run(`INSERT INTO search_tasks
        (id, command, parameters_json, status, total_workers, error_code, created_at, finished_at, idempotency_key, request_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, command, JSON.stringify(parameters), queued ? 'queued' : 'blocked',
      selected === null ? enabledWebsites.length : websites.length, errorCode, time, queued ? null : time, key, requestHash);
      websites.forEach(site => {
        const executionId = crypto.randomUUID();
        const executionKey = hash(id + ':' + site.id);
        const status = queued ? 'queued' : 'blocked';
        run(`INSERT INTO worker_executions
          (id, task_id, website_id, worker_id, status, attempts, error_code, queued_at, finished_at, idempotency_key)
          VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        executionId, id, site.id, site.worker_id, status, queued ? null : 'adapter_pending',
        time, queued ? null : time, executionKey);
        executionEvent(executionId, id, 0, queued ? 'queued' : 'blocked',
          queued ? 'Execution added to the persistent queue.' : 'Execution is blocked until an adapter is verified.',
          queued ? null : 'adapter_pending');
      });
      if (queued) {
        activity('search_queued', 'Search saved and queued for compatible verified adapters.', 'info',
          { taskId: id, selectedSources: websites.length });
      } else {
        activity('search_blocked', 'Search saved; dispatch is blocked because no verified operator adapters are active.', 'warning',
          { taskId: id, selectedSources: websites.length });
        alert(errorCode, 'warning', 'Search dispatch is blocked: operator integrations are still pending verification.');
      }
    });
    return { task: getTask(id), duplicate: false };
  }

  function getTask(id) {
    const row = get('SELECT * FROM search_tasks WHERE id = ?', id);
    if (!row) return null;
    const task = taskView(row);
    task.executions = all('SELECT * FROM worker_executions WHERE task_id = ? ORDER BY queued_at, worker_id', id).map(executionView);
    task.offers = all('SELECT * FROM hotel_offers WHERE task_id = ? ORDER BY total_price', id).map(row => ({
      id: row.id, taskId: row.task_id, operatorName: row.operator_name, sourceUrl: row.source_url, hotelName: row.hotel_name,
      hotelIdentity: row.hotel_identity, totalPrice: row.total_price, currency: row.currency, availability: row.availability,
      offer: json(row.offer_json, {}), verificationStatus: row.verification_status, retrievedAt: row.retrieved_at
    }));
    return task;
  }

  function listTasks(limit = 50) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    return all('SELECT * FROM search_tasks ORDER BY created_at DESC LIMIT ?', safeLimit).map(taskView);
  }

  function transitionTask(id, nextStatus, errorCode) {
    const row = get('SELECT status FROM search_tasks WHERE id = ?', id);
    if (!row || !canTransition(TASK_TRANSITIONS, row.status, nextStatus)) return null;
    const finishedAt = ['completed', 'partial', 'failed', 'cancelled', 'blocked'].includes(nextStatus) ? now() : null;
    run('UPDATE search_tasks SET status = ?, error_code = ?, started_at = COALESCE(started_at, ?), finished_at = ? WHERE id = ?',
      nextStatus, errorCode || null, nextStatus === 'running' ? now() : null, finishedAt, id);
    activity('search_' + nextStatus, 'Search task state changed to ' + nextStatus + '.', 'info', { taskId: id });
    return getTask(id);
  }

  function transitionExecution(id, nextStatus, errorCode) {
    const execution = get(`SELECT e.*, w.integration_status
      FROM worker_executions e JOIN websites w ON w.id = e.website_id WHERE e.id = ?`, id);
    if (!execution || !canTransition(EXECUTION_TRANSITIONS, execution.status, nextStatus)) return null;
    if (['queued', 'running'].includes(nextStatus) && execution.integration_status !== 'verified') return null;
    if (nextStatus === 'queued' && execution.status === 'failed'
      && execution.attempts > settings().retry_limit) return null;
    if (nextStatus === 'running') {
      const current = settings();
      const runningTotal = get("SELECT COUNT(*) AS n FROM worker_executions WHERE status = 'running'").n;
      const runningOperator = get("SELECT COUNT(*) AS n FROM worker_executions WHERE status = 'running' AND website_id = ?", execution.website_id).n;
      if (runningTotal >= current.worker_concurrency || runningOperator >= current.per_operator_concurrency) return null;
    }

    return transaction(() => {
      const time = now();
      const finishedAt = ['completed', 'failed', 'cancelled', 'blocked'].includes(nextStatus) ? time : null;
      run(`UPDATE worker_executions SET status = ?, error_code = ?,
        attempts = attempts + ?, started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, ?) ELSE started_at END,
        finished_at = ?, lease_until = CASE WHEN ? = 'running' THEN lease_until ELSE NULL END WHERE id = ?`,
      nextStatus, errorCode || null, nextStatus === 'running' ? 1 : 0, nextStatus, time, finishedAt, nextStatus, id);

      const counts = get(`SELECT
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        COUNT(*) AS total
        FROM worker_executions WHERE task_id = ?`, execution.task_id);
      run('UPDATE search_tasks SET completed_workers = ?, failed_workers = ? WHERE id = ?',
        counts.completed || 0, counts.failed || 0, execution.task_id);

      let task = get('SELECT status FROM search_tasks WHERE id = ?', execution.task_id);
      if (nextStatus === 'queued' && task && ['blocked', 'failed', 'partial'].includes(task.status)) {
        transitionTask(execution.task_id, 'queued');
        task = get('SELECT status FROM search_tasks WHERE id = ?', execution.task_id);
      }
      if (nextStatus === 'running' && task && task.status === 'queued') transitionTask(execution.task_id, 'running');
      const active = get("SELECT COUNT(*) AS n FROM worker_executions WHERE task_id = ? AND status IN ('queued', 'running')", execution.task_id).n;
      if (!active && task && ['queued', 'running'].includes(task.status)) {
        const terminal = get("SELECT COUNT(*) AS n FROM worker_executions WHERE task_id = ? AND status IN ('blocked', 'failed', 'completed', 'cancelled')", execution.task_id).n;
        if (terminal === counts.total) {
          const target = counts.failed === counts.total ? 'failed' : counts.completed === counts.total ? 'completed' : 'partial';
          transitionTask(execution.task_id, target, target === 'failed' ? 'worker_failures' : null);
        }
      }
      activity('worker_' + nextStatus, 'Worker execution state changed to ' + nextStatus + '.', 'info',
        { executionId: id, taskId: execution.task_id });
      return executionView(get('SELECT * FROM worker_executions WHERE id = ?', id));
    });
  }

  function executionContext(id) {
    const row = get(`SELECT e.*, t.command, t.parameters_json, t.status AS task_status,
      w.name AS website_name, w.url AS website_url, w.website_type, w.custom_instructions,
      w.enabled, w.integration_status
      FROM worker_executions e
      JOIN search_tasks t ON t.id = e.task_id
      JOIN websites w ON w.id = e.website_id
      WHERE e.id = ?`, id);
    if (!row) return null;
    return {
      execution: executionView(row),
      task: { id: row.task_id, command: row.command, status: row.task_status, parameters: json(row.parameters_json, {}) },
      website: {
        id: row.website_id, workerId: row.worker_id, name: row.website_name, url: row.website_url,
        websiteType: row.website_type, customInstructions: row.custom_instructions,
        enabled: !!row.enabled, integrationStatus: row.integration_status
      }
    };
  }

  function listQueuedExecutions(limit = 100) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    return all(`SELECT e.id FROM worker_executions e JOIN search_tasks t ON t.id = e.task_id
      WHERE e.status = 'queued' AND t.status IN ('queued', 'running')
      ORDER BY e.queued_at, e.id LIMIT ?`, safeLimit).map(row => row.id);
  }

  function logExecutions(limit = 100) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    const events = all(`SELECT ev.*, e.worker_id, e.status, e.attempts, e.offers_found, w.name AS website_name
      FROM worker_execution_events ev
      JOIN worker_executions e ON e.id = ev.execution_id
      JOIN websites w ON w.id = e.website_id
      ORDER BY ev.created_at DESC, ev.id DESC LIMIT ?`, safeLimit);
    if (events.length) return events.map(row => ({
      executionId: row.execution_id, taskId: row.task_id, workerId: row.worker_id, website: row.website_name,
      status: row.status, attempts: row.attempts, offersFound: row.offers_found, errorCode: row.error_code,
      eventType: row.event_type, message: row.message, attempt: row.attempt, details: json(row.details_json, {}),
      at: row.created_at
    }));
    return all(`SELECT e.id, e.task_id, e.worker_id, e.status, e.attempts, e.error_code, e.offers_found,
      e.queued_at, e.started_at, e.finished_at, w.name AS website_name
      FROM worker_executions e JOIN websites w ON w.id = e.website_id
      ORDER BY e.queued_at DESC LIMIT ?`, safeLimit).map(row => ({
      executionId: row.id, taskId: row.task_id, workerId: row.worker_id, website: row.website_name,
      status: row.status, attempts: row.attempts, errorCode: row.error_code, offersFound: row.offers_found,
      eventType: 'status', message: 'Execution status snapshot.', at: row.finished_at || row.started_at || row.queued_at
    }));
  }

  function refreshTask(taskId) {
    const counts = get(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
      FROM worker_executions WHERE task_id = ?`, taskId);
    const offerCount = get('SELECT COUNT(*) AS n FROM hotel_offers WHERE task_id = ?', taskId).n;
    const active = (counts.queued || 0) + (counts.running || 0);
    run(`UPDATE search_tasks SET total_workers = ?, completed_workers = ?, failed_workers = ?,
      offers_found = ?, aggregation_status = ? WHERE id = ?`,
    counts.total, counts.completed || 0, counts.failed || 0, offerCount, active ? 'collecting' : 'complete', taskId);

    const task = get('SELECT status FROM search_tasks WHERE id = ?', taskId);
    if (!task || task.status === 'cancelled' || active) return;
    let target;
    if (counts.completed > 0) target = counts.failed > 0 || counts.blocked > 0 || counts.cancelled > 0 ? 'partial' : 'completed';
    else if (counts.failed > 0) target = 'failed';
    else target = 'blocked';
    if (task.status !== target && canTransition(TASK_TRANSITIONS, task.status, target)) {
      transitionTask(taskId, target, target === 'failed' ? 'worker_failures' : target === 'blocked' ? 'no_runnable_workers' : null);
    }
  }

  function claimExecution(id) {
    return transaction(() => {
      const row = get(`SELECT e.status, e.task_id, e.website_id, t.status AS task_status,
        w.enabled, w.integration_status FROM worker_executions e
        JOIN search_tasks t ON t.id = e.task_id JOIN websites w ON w.id = e.website_id WHERE e.id = ?`, id);
      if (!row || row.status !== 'queued' || !['queued', 'running'].includes(row.task_status)
        || !row.enabled || row.integration_status !== 'verified') return null;
      const limits = settings();
      const globalRunning = get("SELECT COUNT(*) AS n FROM worker_executions WHERE status = 'running'").n;
      const operatorRunning = get("SELECT COUNT(*) AS n FROM worker_executions WHERE status = 'running' AND website_id = ?", row.website_id).n;
      if (globalRunning >= limits.worker_concurrency || operatorRunning >= limits.per_operator_concurrency) return null;

      const time = now();
      const leaseUntil = time + limits.search_timeout_seconds * 1000;
      run(`UPDATE worker_executions SET status = 'running', attempts = attempts + 1,
        error_code = NULL, started_at = COALESCE(started_at, ?), finished_at = NULL,
        lease_until = ?, heartbeat_at = ? WHERE id = ?`, time, leaseUntil, time, id);
      run("UPDATE websites SET worker_status = 'running', updated_at = ? WHERE id = ?", time, row.website_id);
      if (row.task_status === 'queued') transitionTask(row.task_id, 'running');
      const execution = get('SELECT attempts FROM worker_executions WHERE id = ?', id);
      executionEvent(id, row.task_id, execution.attempts, 'started', 'Worker execution started.', null, { leaseUntil });
      activity('worker_started', 'Verified worker execution started.', 'info', { taskId: row.task_id, executionId: id });
      return executionContext(id);
    });
  }

  function heartbeatExecution(id) {
    const result = run("UPDATE worker_executions SET heartbeat_at = ? WHERE id = ? AND status = 'running'", now(), id);
    return result.changes > 0;
  }

  function logWorkerEvent(id, eventType, details = {}) {
    if (typeof eventType !== 'string' || !/^[a-z0-9_-]{1,60}$/i.test(eventType)) return false;
    const execution = get("SELECT task_id, attempts FROM worker_executions WHERE id = ? AND status = 'running'", id);
    if (!execution) return false;
    const safeDetails = {};
    if (Number.isInteger(details.recordCount) && details.recordCount >= 0 && details.recordCount <= 1000) {
      safeDetails.recordCount = details.recordCount;
    }
    if (Number.isFinite(details.durationMs) && details.durationMs >= 0 && details.durationMs <= 3600000) {
      safeDetails.durationMs = details.durationMs;
    }
    executionEvent(id, execution.task_id, execution.attempts, 'adapter_' + eventType,
      'Worker reported an operational progress event.', null, safeDetails);
    return true;
  }

  function setWebsiteWorkerStatus(websiteId, fallback) {
    const running = get("SELECT COUNT(*) AS n FROM worker_executions WHERE website_id = ? AND status = 'running'", websiteId).n;
    run('UPDATE websites SET worker_status = ?, updated_at = ? WHERE id = ?',
      running ? 'running' : fallback, now(), websiteId);
  }

  function completeExecution(id, offers = []) {
    if (!Array.isArray(offers) || offers.length > 1000) return { error: 'invalid_worker_result' };
    const context = executionContext(id);
    if (!context || context.execution.status !== 'running' || context.website.integrationStatus !== 'verified') {
      return { error: 'execution_not_authorized' };
    }
    let normalized;
    try {
      normalized = offers.map(offer => normalizeOffer(Object.assign({}, offer, { operatorName: context.website.name }), now));
    } catch (error) {
      return { error: 'invalid_worker_result' };
    }
    return transaction(() => {
      const current = get("SELECT status, task_id, website_id, attempts FROM worker_executions WHERE id = ?", id);
      if (!current || current.status !== 'running') return { error: 'execution_not_running' };
      normalized.forEach(offer => {
        const keyData = {
          operatorName: offer.operatorName, sourceUrl: offer.sourceUrl, hotelName: offer.hotelName,
          hotelIdentity: offer.hotelIdentity, hotelLocation: offer.hotelLocation, checkIn: offer.checkIn,
          checkOut: offer.checkOut, roomType: offer.roomType, mealPlan: offer.mealPlan, totalPrice: offer.totalPrice,
          currency: offer.currency, availability: offer.availability, flightIncluded: offer.flightIncluded,
          directFlight: offer.directFlight, baggage: offer.baggage
        };
        const dedupeKey = hash(JSON.stringify(keyData));
        run(`INSERT OR IGNORE INTO hotel_offers
          (id, task_id, execution_id, operator_name, source_url, hotel_name, hotel_identity, total_price,
           currency, availability, offer_json, verification_status, retrieved_at, dedupe_key)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        offer.id, current.task_id, id, offer.operatorName, offer.sourceUrl, offer.hotelName, offer.hotelIdentity,
        offer.totalPrice, offer.currency, offer.availability, JSON.stringify(offer), offer.verificationStatus,
        offer.retrievedAt, dedupeKey);
      });
      const offerCount = get('SELECT COUNT(*) AS n FROM hotel_offers WHERE execution_id = ?', id).n;
      run(`UPDATE worker_executions SET status = 'completed', error_code = NULL, offers_found = ?,
        lease_until = NULL, finished_at = ? WHERE id = ?`, offerCount, now(), id);
      run('UPDATE websites SET last_successful_search = ?, last_error = NULL WHERE id = ?', now(), current.website_id);
      setWebsiteWorkerStatus(current.website_id, 'idle');
      executionEvent(id, current.task_id, current.attempts, 'completed', 'Worker execution completed.',
        null, { offersFound: offerCount });
      activity('worker_completed', 'Worker execution completed.', 'info',
        { taskId: current.task_id, executionId: id, offersFound: offerCount });
      refreshTask(current.task_id);
      emit({ type: 'task_progress', taskId: current.task_id });
      return { execution: executionView(get('SELECT * FROM worker_executions WHERE id = ?', id)), task: getTask(current.task_id) };
    });
  }

  function failExecution(id, errorCode, retryable = true) {
    const code = typeof errorCode === 'string' && /^[a-z0-9_-]{1,80}$/i.test(errorCode) ? errorCode : 'worker_error';
    return transaction(() => {
      const current = get("SELECT * FROM worker_executions WHERE id = ? AND status = 'running'", id);
      if (!current) return null;
      const shouldRetry = retryable && current.attempts <= settings().retry_limit;
      const nextStatus = shouldRetry ? 'queued' : 'failed';
      run(`UPDATE worker_executions SET status = ?, error_code = ?, lease_until = NULL, finished_at = ?
        WHERE id = ?`, nextStatus, code, shouldRetry ? null : now(), id);
      run('UPDATE websites SET last_error = ? WHERE id = ?', code, current.website_id);
      setWebsiteWorkerStatus(current.website_id, shouldRetry ? 'idle' : 'failed');
      executionEvent(id, current.task_id, current.attempts,
        shouldRetry ? 'retry_scheduled' : 'failed',
        shouldRetry ? 'Worker failed; a bounded retry was queued.' : 'Worker failed after exhausting its retry policy.',
        code, { retrying: shouldRetry });
      activity(shouldRetry ? 'worker_retry_scheduled' : 'worker_failed',
        shouldRetry ? 'Worker failure queued for retry.' : 'Worker failed after exhausting retries.',
        shouldRetry ? 'warning' : 'error', { taskId: current.task_id, executionId: id, errorCode: code });
      if (!shouldRetry) {
        alert('worker_failed', 'error', 'A verified worker execution failed. Review its structured execution log.');
      }
      if (!shouldRetry) refreshTask(current.task_id);
      emit({ type: 'task_progress', taskId: current.task_id });
      return executionView(get('SELECT * FROM worker_executions WHERE id = ?', id));
    });
  }

  function blockExecution(id, errorCode = 'adapter_unavailable') {
    const code = typeof errorCode === 'string' && /^[a-z0-9_-]{1,80}$/i.test(errorCode) ? errorCode : 'adapter_unavailable';
    return transaction(() => {
      const current = get("SELECT * FROM worker_executions WHERE id = ? AND status = 'queued'", id);
      if (!current) return null;
      run(`UPDATE worker_executions SET status = 'blocked', error_code = ?, lease_until = NULL, finished_at = ? WHERE id = ?`,
        code, now(), id);
      executionEvent(id, current.task_id, current.attempts, 'blocked', 'No registered adapter can execute this task.', code);
      activity('worker_blocked', 'Queued execution blocked because its adapter is unavailable.', 'warning',
        { taskId: current.task_id, executionId: id, errorCode: code });
      refreshTask(current.task_id);
      return executionView(get('SELECT * FROM worker_executions WHERE id = ?', id));
    });
  }

  function recoverInterruptedExecutions() {
    return transaction(() => {
      const interrupted = all("SELECT * FROM worker_executions WHERE status = 'running'");
      interrupted.forEach(execution => {
        const retry = execution.attempts <= settings().retry_limit;
        const status = retry ? 'queued' : 'failed';
        run(`UPDATE worker_executions SET status = ?, error_code = 'worker_interrupted',
          lease_until = NULL, heartbeat_at = ?, finished_at = ? WHERE id = ?`,
        status, now(), retry ? null : now(), execution.id);
        executionEvent(execution.id, execution.task_id, execution.attempts,
          retry ? 'recovered' : 'failed',
          retry ? 'Interrupted execution requeued during restart recovery.' : 'Interrupted execution exhausted its retry limit.',
          'worker_interrupted', { retrying: retry });
      });
      run("UPDATE websites SET worker_status = 'idle', updated_at = ? WHERE worker_status = 'running'", now());
      const tasks = all("SELECT id FROM search_tasks WHERE status = 'running'");
      tasks.forEach(task => {
        const queued = get("SELECT COUNT(*) AS n FROM worker_executions WHERE task_id = ? AND status = 'queued'", task.id).n;
        if (queued) {
          run("UPDATE search_tasks SET status = 'queued', error_code = 'worker_interrupted', finished_at = NULL WHERE id = ?", task.id);
          activity('search_recovered', 'Running task returned to the persistent queue after restart.', 'warning', { taskId: task.id });
        }
        refreshTask(task.id);
      });
      if (interrupted.length) emit({ type: 'recovery', recovered: interrupted.length });
      return interrupted.length;
    });
  }

  function cancelTask(id) {
    const task = get('SELECT status FROM search_tasks WHERE id = ?', id);
    if (!task || !canTransition(TASK_TRANSITIONS, task.status, 'cancelled')) return null;
    transaction(() => {
      const activeExecutions = all("SELECT id, task_id, website_id, attempts FROM worker_executions WHERE task_id = ? AND status IN ('blocked', 'queued', 'running')", id);
      run("UPDATE search_tasks SET status = 'cancelled', error_code = NULL, finished_at = ? WHERE id = ?", now(), id);
      run("UPDATE worker_executions SET status = 'cancelled', error_code = NULL, lease_until = NULL, finished_at = ? WHERE task_id = ? AND status IN ('blocked', 'queued', 'running')", now(), id);
      activeExecutions.forEach(execution => {
        executionEvent(execution.id, execution.task_id, execution.attempts, 'cancelled', 'Worker execution cancelled by Owner.');
        setWebsiteWorkerStatus(execution.website_id, 'idle');
      });
      activity('search_cancelled', 'Search task cancelled by Owner.', 'info', { taskId: id });
    });
    return getTask(id);
  }

  function listActivities(limit = 100) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    return all('SELECT * FROM activities ORDER BY created_at DESC, id DESC LIMIT ?', safeLimit).map(row => ({
      id: row.id, type: row.event_type, severity: row.severity, message: row.message,
      details: json(row.details_json, {}), at: row.created_at
    }));
  }

  function listAlerts(limit = 100) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    return all('SELECT * FROM system_alerts ORDER BY created_at DESC LIMIT ?', safeLimit).map(row => ({
      id: row.id, type: row.alert_type, severity: row.severity, message: row.message,
      status: row.status, createdAt: row.created_at, resolvedAt: row.resolved_at
    }));
  }

  function resolveAlert(id) {
    const result = run("UPDATE system_alerts SET status = 'resolved', resolved_at = ? WHERE id = ? AND status = 'open'", now(), id);
    if (!result.changes) return false;
    activity('alert_resolved', 'System alert resolved.', 'info', { alertId: id });
    return true;
  }

  function listLogs(limit = 100) {
    return logExecutions(limit);
  }

  function listOffers(taskId) {
    return getTask(taskId)?.offers || null;
  }

  function runtimeMetrics() {
    const total = os.totalmem();
    const free = os.freemem();
    const cpu = process.cpuUsage();
    const cpus = os.cpus().length || 1;
    const cpuPercent = Math.min(100, Math.round(((cpu.user + cpu.system) / (process.uptime() * 1000000 * cpus)) * 1000) / 10);
    let databaseBytes = null;
    try { databaseBytes = fs.statSync(db.file).size; } catch (error) { /* database may be unavailable */ }
    return {
      processUptimeSeconds: Math.floor(process.uptime()),
      processMemoryBytes: process.memoryUsage().rss,
      processCpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : null,
      systemMemoryBytes: total,
      systemMemoryUsedBytes: total - free,
      systemLoad: process.platform === 'win32' ? null : os.loadavg()[0],
      databaseBytes
    };
  }

  function overview() {
    const counts = get(`SELECT
      COUNT(*) AS configured,
      SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) AS enabled,
      SUM(CASE WHEN integration_status = 'verified' THEN 1 ELSE 0 END) AS verified,
      SUM(CASE WHEN integration_status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN worker_status = 'running' THEN 1 ELSE 0 END) AS running,
      SUM(CASE WHEN worker_status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM websites`);
    const tasks = get(`SELECT
      SUM(CASE WHEN status IN ('queued', 'running') THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) AS partial,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      AVG(CASE WHEN status IN ('completed', 'partial') AND finished_at IS NOT NULL AND started_at IS NOT NULL
        THEN finished_at - started_at END) AS avg_ms
      FROM search_tasks`);
    return {
      websites: {
        configured: counts.configured || 0, enabled: counts.enabled || 0, verified: counts.verified || 0,
        pending: counts.pending || 0, running: counts.running || 0, failed: counts.failed || 0
      },
      tasks: {
        active: tasks.active || 0, completed: tasks.completed || 0, partial: tasks.partial || 0,
        failed: tasks.failed || 0, averageCompletionMs: tasks.avg_ms == null ? null : Math.round(tasks.avg_ms)
      },
      workers: get(`SELECT
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked
        FROM worker_executions`),
      openAlerts: get("SELECT COUNT(*) AS n FROM system_alerts WHERE status = 'open'").n,
      lastActivity: get('SELECT event_type, message, created_at FROM activities ORDER BY created_at DESC, id DESC LIMIT 1') || null,
      runtime: runtimeMetrics(),
      generatedAt: now()
    };
  }

  function mainAgent() {
    const latest = get('SELECT * FROM search_tasks ORDER BY created_at DESC LIMIT 1');
    const globalCounts = get(`SELECT
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked
      FROM worker_executions`);
    return {
      orchestration: 'structured-dispatch-ready',
      naturalLanguageParser: 'not_configured',
      browserWorkers: 'pending_integration',
      latestTask: latest ? taskView(latest) : null,
      workerCounts: {
        blocked: globalCounts.blocked || 0, queued: globalCounts.queued || 0,
        completed: globalCounts.completed || 0, failed: globalCounts.failed || 0,
        running: globalCounts.running || 0
      }
    };
  }

  function reportOffer(executionId, input) {
    const execution = get('SELECT e.*, w.name, w.integration_status FROM worker_executions e JOIN websites w ON w.id = e.website_id WHERE e.id = ?', executionId);
    if (!execution || execution.status !== 'running' || execution.integration_status !== 'verified') return { error: 'execution_not_authorized' };
    let offer;
    try { offer = normalizeOffer(Object.assign({}, input, { operatorName: execution.name }), now); }
    catch (error) { return { error: 'invalid_offer' }; }
    run(`INSERT INTO hotel_offers
      (id, task_id, execution_id, operator_name, source_url, hotel_name, hotel_identity, total_price,
       currency, availability, offer_json, verification_status, retrieved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    offer.id, execution.task_id, execution.id, offer.operatorName, offer.sourceUrl, offer.hotelName, offer.hotelIdentity,
    offer.totalPrice, offer.currency, offer.availability, JSON.stringify(offer), offer.verificationStatus, offer.retrievedAt);
    emit({ type: 'offer_received', taskId: execution.task_id });
    return offer;
  }

  return {
    listWebsites, createWebsite, updateWebsite, markWorkerConnected, markAuthStatus, settings, updateSettings, createSearch, getTask, listTasks,
    transitionTask, transitionExecution, executionContext, listQueuedExecutions, claimExecution,
    heartbeatExecution, logWorkerEvent, completeExecution, failExecution, blockExecution, recoverInterruptedExecutions,
    cancelTask, listActivities, listAlerts, resolveAlert, listLogs, listOffers, overview, mainAgent,
    reportOffer, normalizeOffer, compareOffers
  };
}

module.exports = { createOwnerService, validateSearchParameters, parseWebsiteUrl };
