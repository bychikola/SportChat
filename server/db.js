/* Клиент Supabase (серверный, service_role).
 * Активен только когда заданы SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY.
 * Если не заданы — isConfigured() = false, сервер работает на локальных
 * JSON-хранилищах (data/*.json). */

import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL || '';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let client = null;

export function db() {
  if (!client) {
    if (!isConfigured()) throw new Error('Supabase не настроен: задай SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY');
    client = createClient(URL, KEY, { auth: { persistSession: false } });
  }
  return client;
}

export function isConfigured() {
  return Boolean(URL && KEY);
}
