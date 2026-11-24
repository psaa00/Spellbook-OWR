const API_ROOT = "https://www.dnd5eapi.co/api";
const SDK_URL = "https://esm.sh/@owlbear-rodeo/sdk@3.1.0";
const STORAGE_PREFIX = "obr-spellbook:v1";
const CUSTOM_URL = new URL("./custom-spells.json", import.meta.url).href;

const el = (id) => document.getElementById(id);
const state = {
  OBR: null,
  role: "UNKNOWN",
  standalone: window.parent === window,
  edition: "2014",
  srd: [],
  publishedCustom: [],
  draft: [],
  selectedId: null,
  visible: [],
  loading: false,
  loadGeneration: 0,
  roomRolls: [],
  unsubscribeRolls: null,
};
const ROLL_CHANNEL = "com.psaa00.spellbook/rolls";

const SCHOOL_NAMES = {
  abjuration: "Ограждение", conjuration: "Вызов", divination: "Прорицание",
  enchantment: "Очарование", evocation: "Воплощение", illusion: "Иллюзия",
  necromancy: "Некромантия", transmutation: "Преобразование",
  ограждение: "Ограждение", вызов: "Вызов", прорицание: "Прорицание",
  очарование: "Очарование", воплощение: "Воплощение", иллюзия: "Иллюзия",
  некромантия: "Некромантия", преобразование: "Преобразование",
};
const CLASS_NAMES = {
  artificer: "Изобретатель", barbarian: "Варвар", bard: "Бард", cleric: "Жрец",
  druid: "Друид", fighter: "Воин", monk: "Монах", paladin: "Паладин",
  ranger: "Следопыт", rogue: "Плут", sorcerer: "Чародей", warlock: "Колдун",
  wizard: "Волшебник",
};
const LEVEL_LABELS = ["Заговор", "1-й", "2-й", "3-й", "4-й", "5-й", "6-й", "7-й", "8-й", "9-й"];

function setNotice(message, kind = "") {
  const box = el("notice");
  box.className = `notice ${kind}`.trim();
  el("noticeText").textContent = message;
}
function setAdminStatus(message) { el("adminStatus").textContent = message; }
function niceSchool(value) {
  if (!value) return "Не указана";
  const raw = String(value).trim();
  return SCHOOL_NAMES[raw.toLowerCase()] || raw.charAt(0).toUpperCase() + raw.slice(1);
}
function niceClass(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return CLASS_NAMES[raw.toLowerCase()] || raw;
}
function getObjectName(value) {
  if (Array.isArray(value)) return value.map(getObjectName).filter(Boolean);
  if (value && typeof value === "object") return value.name || value.index || value.title || "";
  return value == null ? "" : String(value);
}
function toArray(value) {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) return value.flatMap(toArray).map((x) => String(x).trim()).filter(Boolean);
  if (typeof value === "object") return [String(getObjectName(value)).trim()].filter(Boolean);
  return String(value).split(/[;|,]/).map((x) => x.trim()).filter(Boolean);
}
function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normal = String(value ?? "").trim().toLowerCase();
  if (["", "0", "false", "no", "нет", "не", "off", "n", "ложь"].includes(normal)) return false;
  if (["1", "true", "yes", "да", "on", "y", "истина"].includes(normal)) return true;
  return Boolean(value);
}
function textValue(value) {
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join("\n\n");
  if (value && typeof value === "object") return String(value.name || value.text || "");
  return value == null ? "" : String(value);
}
function safeHttpUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch { return ""; }
}
function slugify(value) {
  return String(value || "spell")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "spell";
}
function parseLevel(value) {
  if (value === 0 || value === "0" || String(value).toLowerCase().includes("заговор")) return 0;
  const match = String(value ?? "").match(/[0-9]/);
  if (!match) return 0;
  return Math.max(0, Math.min(9, Number(match[0])));
}
function normaliseDamageMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([key, formula]) => [String(key), textValue(formula).trim()])
    .filter(([, formula]) => formula));
}
function normaliseSpell(raw, index = 0, source = "Пользовательская библиотека") {
  if (!raw || typeof raw !== "object") return null;
  const name = textValue(raw.name ?? raw.title ?? raw["Название"] ?? raw["Заклинание"]).trim();
  if (!name) return null;
  const rawSchool = getObjectName(raw.school ?? raw["Школа"]);
  const rawClasses = raw.classes ?? raw.class ?? raw["Классы"] ?? raw["Класс"] ?? [];
  const desc = raw.description ?? raw.desc ?? raw.text ?? raw["Описание"] ?? raw["Текст"] ?? "";
  const rawDamage = raw.damage;
  const rawDamageEntries = Array.isArray(rawDamage) ? rawDamage : (rawDamage && typeof rawDamage === "object" ? [rawDamage] : []);
  const exportedProfiles = Array.isArray(raw.damageProfiles) ? raw.damageProfiles : [];
  const damageProfiles = (exportedProfiles.length ? exportedProfiles : rawDamageEntries).map((entry) => ({
    type: textValue(getObjectName(entry?.type ?? entry?.damage_type ?? entry?.damageType ?? "")),
    formula: textValue(entry?.formula ?? "").trim(),
    atSlotLevel: normaliseDamageMap(entry?.atSlotLevel ?? entry?.damage_at_slot_level ?? entry?.at_slot_level),
    atCharacterLevel: normaliseDamageMap(entry?.atCharacterLevel ?? entry?.damage_at_character_level ?? entry?.at_character_level),
  })).filter((profile) => profile.formula || Object.keys(profile.atSlotLevel).length || Object.keys(profile.atCharacterLevel).length);
  const damageFormula = textValue(raw.damageFormula ?? raw.damage_formula ?? raw["Формула урона"] ?? raw["Урон"] ?? (typeof rawDamage === "string" ? rawDamage : "")).trim();
  const damageAtSlotLevel = normaliseDamageMap(raw.damageAtSlotLevel ?? raw.damage_at_slot_level);
  const damageAtCharacterLevel = normaliseDamageMap(raw.damageAtCharacterLevel ?? raw.damage_at_character_level);
  const damageType = textValue(getObjectName(raw.damageType ?? raw.damage_type ?? ""));
  if (!damageProfiles.length && (damageFormula || Object.keys(damageAtSlotLevel).length || Object.keys(damageAtCharacterLevel).length)) {
    damageProfiles.push({ type: damageType, formula: damageFormula, atSlotLevel: damageAtSlotLevel, atCharacterLevel: damageAtCharacterLevel });
  }
  const id = String(raw.id ?? raw.index ?? `custom-${slugify(name)}`);
  const spell = {
    id,
    name,
    level: parseLevel(raw.level ?? raw.spellLevel ?? raw["Уровень"] ?? raw["Круг"]),
    school: rawSchool || "Не указана",
    classes: toArray(rawClasses).map((x) => niceClass(x)),
    castingTime: textValue(raw.castingTime ?? raw.casting_time ?? raw["Время накладывания"] ?? raw["Время сотворения"]),
    range: textValue(raw.range ?? raw["Дальность"] ?? raw["Дистанция"]),
    components: toArray(raw.components ?? raw["Компоненты"]),
    material: textValue(raw.material ?? raw["Материал"]),
    duration: textValue(raw.duration ?? raw["Длительность"]),
    concentration: parseBoolean(raw.concentration ?? raw["Концентрация"]),
    ritual: parseBoolean(raw.ritual ?? raw["Ритуал"]),
    description: textValue(desc),
    higherLevel: textValue(raw.higherLevel ?? raw.higher_level ?? raw["На высоких уровнях"]),
    damageFormula,
    damageAtSlotLevel,
    damageAtCharacterLevel,
    damageType,
    damageProfiles,
    source: textValue(raw.source ?? raw.sourceName ?? raw["Источник"]) || source,
    sourceUrl: safeHttpUrl(textValue(raw.sourceUrl ?? raw.url)),
    origin: raw.origin || "custom",
  };
  if (spell.school && SCHOOL_NAMES[spell.school.toLowerCase()]) spell.school = SCHOOL_NAMES[spell.school.toLowerCase()];
  return spell;
}
function normaliseSrdSpell(raw, year) {
  const item = normaliseSpell(raw, 0, year === "2014" ? "SRD 5.1" : "SRD 5.2");
  if (!item) return null;
  item.id = `srd-${year}-${raw.index || slugify(item.name)}`;
  item.origin = "srd";
  item.source = year === "2014" ? "SRD 5.1 · D&D 5e 2014" : "SRD 5.2 · D&D 5e 2024";
  item.sourceUrl = raw.url ? `https://www.dnd5eapi.co${raw.url}` : "https://docs.dnd5eapi.co/";
  item.classes = toArray(raw.classes).map(niceClass);
  item.school = niceSchool(getObjectName(raw.school));
  return item;
}
function uniqueMerge(...groups) {
  const map = new Map();
  for (const group of groups) {
    for (const spell of group || []) {
      if (!spell || !spell.name) continue;
      const key = slugify(spell.name);
      const previous = map.get(key);
      map.set(key, previous ? { ...previous, ...spell, classes: spell.classes?.length ? spell.classes : previous.classes } : spell);
    }
  }
  return [...map.values()];
}
function getCurrentSpells() {
  return uniqueMerge(state.srd, state.publishedCustom, isGM() ? state.draft : []);
}
function isGM() { return state.role === "GM" || state.standalone; }
function localGet(key) {
  try { return JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}:${key}`) || "null"); }
  catch { return null; }
}
function localSet(key, value) {
  try { localStorage.setItem(`${STORAGE_PREFIX}:${key}`, JSON.stringify(value)); return true; }
  catch { setNotice("Не удалось сохранить кэш в браузере. Возможно, закончилось место.", "error"); return false; }
}
function waitForObrReady(OBR) {
  if (OBR.isReady) return Promise.resolve();
  return new Promise((resolve) => {
    let off;
    const done = () => { off?.(); resolve(); };
    off = OBR.onReady(done);
    setTimeout(done, 12000);
  });
}
async function connectToOwlbear() {
  if (state.standalone) {
    state.role = "GM";
    el("roleBadge").textContent = "ПРЕДПРОСМОТР · МАСТЕР";
    el("roleBadge").classList.add("gm");
    el("adminPanel").hidden = false;
    setNotice("Предпросмотр вне Owlbear Rodeo: можно проверить каталог и импорт. Для игроков подключи расширение в комнате.");
    return;
  }
  try {
    const mod = await import(SDK_URL);
    const OBR = mod.default || mod.OBR || mod;
    state.OBR = OBR;
    if (!OBR.isAvailable) {
      state.role = "PLAYER";
      el("roleBadge").textContent = "ВНЕ OWLBEAR";
      setNotice("Owlbear Rodeo не обнаружен. Интерфейс открыт в режиме просмотра.");
      return;
    }
    await waitForObrReady(OBR);
    state.role = await OBR.player.getRole();
    if (OBR.broadcast?.onMessage) {
      state.unsubscribeRolls?.();
      state.unsubscribeRolls = OBR.broadcast.onMessage(ROLL_CHANNEL, (event) => {
        const roll = event?.data;
        if (!roll || roll.kind !== "spell-damage-roll" || typeof roll.total !== "number") return;
        addRoomRoll({ ...roll, remote: true });
      });
    }
    if (state.role === "GM") {
      el("roleBadge").textContent = "МАСТЕР";
      el("roleBadge").classList.add("gm");
      el("adminPanel").hidden = false;
      setNotice("Ты вошёл как мастер. Импортируй пользовательские заклинания и опубликуй файл для игроков.");
    } else {
      el("roleBadge").textContent = "ИГРОК";
      el("adminPanel").hidden = true;
      setNotice("Режим игрока: каталог доступен для поиска и просмотра.");
    }
  } catch (error) {
    state.role = "PLAYER";
    el("roleBadge").textContent = "ИГРОК";
    el("adminPanel").hidden = true;
    setNotice("Не удалось подключить SDK Owlbear Rodeo. Каталог можно просматривать, но управление доступно только после подключения в комнате.", "error");
    console.error("OBR SDK connection error", error);
  }
}
async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Accept: "application/json", ...(options.headers || {}) } });
  if (!response.ok) throw new Error(`HTTP ${response.status} при запросе ${url}`);
  return response.json();
}
async function loadPublishedCustom() {
  try {
    const url = new URL(CUSTOM_URL);
    url.searchParams.set("_refresh", String(Date.now()));
    const data = await fetchJson(url.toString(), { cache: "no-store" });
    const records = Array.isArray(data) ? data : (data.spells || data.results || []);
    state.publishedCustom = records.map((x, i) => normaliseSpell(x, i, "Библиотека мастера")).filter(Boolean).map((x) => ({ ...x, origin: "published" }));
  } catch (error) {
    state.publishedCustom = [];
    console.info("Custom spell file is not published yet or could not be loaded:", error.message);
  }
}
function loadDraft() {
  const stored = localGet("draft");
  state.draft = Array.isArray(stored) ? stored.map((x, i) => normaliseSpell(x, i, "Черновик мастера")).filter(Boolean).map((x) => ({ ...x, origin: "draft", source: x.source || "Черновик мастера" })) : [];
  updateDraftUi();
}
async function mapLimit(items, limit, task, onProgress) {
  const results = new Array(items.length);
  let next = 0, done = 0;
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try { results[index] = await task(items[index], index); }
      catch (error) { results[index] = null; console.warn("Spell detail failed", items[index], error); }
      done++;
      if (onProgress) onProgress(done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results.filter(Boolean);
}
async function loadSrd(year, force = false) {
  const generation = ++state.loadGeneration;
  state.loading = true;
  el("refreshSrd").disabled = true;
  el("refreshSrd").classList.add("spinning");
  const cached = localGet(`srd-${year}`);
  const cacheHasDamageSchema = cached && Array.isArray(cached.spells) && cached.spells.every((spell) => Object.prototype.hasOwnProperty.call(spell || {}, "damageProfiles"));
  const cacheIsFresh = cached && Array.isArray(cached.spells) && cacheHasDamageSchema && Date.now() - cached.savedAt < 7 * 24 * 60 * 60 * 1000;
  if (!force && cacheIsFresh) {
    state.srd = cached.spells;
    state.loading = false;
    el("refreshSrd").disabled = false;
    el("refreshSrd").classList.remove("spinning");
    setNotice(`Открытая библиотека SRD ${year === "2014" ? "5.1" : "5.2"} загружена из кэша (${state.srd.length} заклинаний).`, "success");
    rebuild();
    return;
  }
  setNotice(`Получаем список заклинаний SRD ${year}…`);
  try {
    const list = await fetchJson(`${API_ROOT}/${year}/spells`);
    const refs = list.results || [];
    if (!refs.length) throw new Error("API вернул пустой список заклинаний");
    setNotice(`Загружаем описания заклинаний: 0 из ${refs.length}…`);
    const details = await mapLimit(refs, 10, async (ref) => {
      if (!ref.url) return ref;
      try { return await fetchJson(`https://www.dnd5eapi.co${ref.url}`); }
      catch { return ref; }
    }, (done, total) => setNotice(`Загружаем описания заклинаний: ${done} из ${total}…`));
    if (generation !== state.loadGeneration || year !== state.edition) return;
    state.srd = details.map((x) => normaliseSrdSpell(x, year)).filter(Boolean);
    localSet(`srd-${year}`, { savedAt: Date.now(), spells: state.srd });
    setNotice(`Готово: загружено ${state.srd.length} заклинаний из SRD ${year === "2014" ? "5.1" : "5.2"}. Текущий API не содержит русского перевода; русские версии можно импортировать отдельно.`, "success");
  } catch (error) {
    if (generation !== state.loadGeneration || year !== state.edition) return;
    if (cached && Array.isArray(cached.spells)) {
      state.srd = cached.spells;
      setNotice(`Не удалось обновить API. Используется сохранённая база (${state.srd.length} заклинаний).`, "error");
    } else {
      state.srd = [];
      setNotice(`Не удалось получить SRD из API: ${error.message}. Проверь интернет-соединение или импортируй свой JSON/CSV.`, "error");
    }
  } finally {
    if (generation === state.loadGeneration) {
      state.loading = false;
      el("refreshSrd").disabled = false;
      el("refreshSrd").classList.remove("spinning");
      rebuild();
    }
  }
}

function csvRows(text) {
  const delimiter = (text.split(/\r?\n/, 1)[0].match(/;/g) || []).length > (text.split(/\r?\n/, 1)[0].match(/,/g) || []).length ? ";" : ",";
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows.shift().map((x) => x.trim().toLowerCase());
  return rows.map((values) => Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""])));
}
function parseMarkdown(text, filename) {
  const matches = [...text.matchAll(/^#{1,2}\s+(.+)$/gm)];
  const blocks = [];
  if (!matches.length) {
    const name = filename.replace(/\.[^.]+$/, "") || "Импортированное заклинание";
    return [{ name, description: text.trim(), source: "Импортированный Markdown/TXT" }];
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const lines = text.slice(start, end).trim().split(/\r?\n/);
    const spell = { name: matches[i][1].trim(), source: "Импортированный Markdown" };
    const body = [];
    for (const line of lines) {
      const match = line.match(/^\s*(Уровень|Level|Школа|School|Классы|Класс|Classes|Class|Время накладывания|Время сотворения|Casting time|Дальность|Дистанция|Range|Длительность|Duration|Компоненты|Components|Урон|Формула урона|Damage)\s*:\s*(.*)$/i);
      if (!match) { body.push(line); continue; }
      const key = match[1].toLowerCase(); const value = match[2].trim();
      if (key.includes("уров") || key === "level") spell.level = value;
      else if (key.includes("школ") || key === "school") spell.school = value;
      else if (key.includes("класс") || key === "class" || key === "classes") spell.classes = value;
      else if (key.includes("время") || key === "casting time") spell.castingTime = value;
      else if (key.includes("даль") || key.includes("дистан") || key === "range") spell.range = value;
      else if (key.includes("длитель") || key === "duration") spell.duration = value;
      else if (key.includes("компон") || key === "components") spell.components = value;
      else if (key.includes("урон") || key === "damage") spell.damageFormula = value;
    }
    spell.description = body.join("\n").replace(/^\s*Описание\s*:?\s*/i, "").trim();
    blocks.push(spell);
  }
  return blocks;
}
async function parseImportFile(file) {
  const text = await file.text();
  const ext = file.name.split(".").pop().toLowerCase();
  if (ext === "json") {
    const raw = JSON.parse(text);
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw.spells)) return raw.spells;
    if (Array.isArray(raw.results)) return raw.results;
    throw new Error("В JSON не найден массив заклинаний. Ожидается массив или поле spells.");
  }
  if (ext === "csv") return csvRows(text);
  if (ext === "md" || ext === "markdown" || ext === "txt") return parseMarkdown(text, file.name);
  throw new Error("Поддерживаются JSON, CSV, Markdown и TXT.");
}
function updateDraftUi() {
  el("draftCount").textContent = `В черновике: ${state.draft.length} ${plural(state.draft.length, "заклинание", "заклинания", "заклинаний")}`;
}
function plural(n, one, few, many) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
async function importFile(file) {
  if (!isGM()) return;
  try {
    const raw = await parseImportFile(file);
    const imported = raw.map((x, i) => normaliseSpell(x, i, `Импорт: ${file.name}`)).filter(Boolean).map((x) => ({ ...x, origin: "draft", source: x.source || `Импорт: ${file.name}` }));
    if (!imported.length) throw new Error("В файле не найдено ни одного заклинания с названием.");
    state.draft = uniqueMerge(state.draft, imported);
    localSet("draft", state.draft);
    updateDraftUi();
    rebuild();
    setAdminStatus(`Импортировано/обновлено: ${imported.length}. Сейчас в черновике: ${state.draft.length}.`);
    setNotice(`Добавлено в черновик ${imported.length} ${plural(imported.length, "заклинание", "заклинания", "заклинаний")}. Игроки увидят их после публикации JSON на GitHub.`, "success");
  } catch (error) {
    setAdminStatus(`Ошибка импорта: ${error.message}`);
    setNotice(`Не удалось импортировать файл: ${error.message}`, "error");
  } finally {
    el("spellFileInput").value = "";
  }
}
function exportPublishedFile() {
  if (!isGM()) return;
  const spells = uniqueMerge(state.publishedCustom, state.draft).map((s) => {
    const { origin, ...exportable } = s;
    return exportable;
  });
  const payload = { format: "obr-spellbook-v1", exportedAt: new Date().toISOString(), spells };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "custom-spells.json"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setAdminStatus(`Файл подготовлен: ${spells.length} пользовательских заклинаний. Загрузи custom-spells.json в корень GitHub-репозитория.`);
  setNotice("Файл custom-spells.json скачан. Теперь замени им одноимённый файл в GitHub-репозитории, чтобы игроки увидели изменения.", "success");
}
function clearDraft() {
  if (!isGM()) return;
  if (!confirm("Удалить локальный черновик пользовательских заклинаний? Уже опубликованный custom-spells.json на GitHub не изменится.")) return;
  state.draft = [];
  localSet("draft", []);
  updateDraftUi();
  rebuild();
  setAdminStatus("Локальный черновик очищен. Опубликованная библиотека не изменена.");
  setNotice("Черновик мастера очищен.", "success");
}

function parseDiceFormula(formula) {
  const input = String(formula || "").replace(/\s+/g, "").toLowerCase();
  if (!input || input.length > 120) throw new Error("Пустая или слишком длинная формула.");
  let cursor = 0;
  let sign = 1;
  let totalDice = 0;
  const groups = [];
  let modifier = 0;
  let hasTerm = false;
  while (cursor < input.length) {
    if (input[cursor] === "+") { sign = 1; cursor++; }
    else if (input[cursor] === "-") { sign = -1; cursor++; }
    else if (hasTerm) throw new Error("Проверь знаки между частями формулы.");
    const rest = input.slice(cursor);
    const diceMatch = rest.match(/^(\d*)d(\d+)/i);
    if (diceMatch) {
      const count = diceMatch[1] === "" ? 1 : Number(diceMatch[1]);
      const sides = Number(diceMatch[2]);
      if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error("Количество костей должно быть от 1 до 100.");
      if (!Number.isInteger(sides) || sides < 2 || sides > 1000) throw new Error("У кости должно быть от 2 до 1000 граней.");
      totalDice += count;
      if (totalDice > 200) throw new Error("В одном броске допускается не более 200 костей.");
      groups.push({ type: "dice", count, sides, sign });
      cursor += diceMatch[0].length;
    } else {
      const numberMatch = rest.match(/^\d+/);
      if (!numberMatch) throw new Error(`Не удалось разобрать формулу рядом с «${rest}». Используй формат 2d6+3.`);
      const value = Number(numberMatch[0]);
      if (value > 100000) throw new Error("Слишком большой модификатор.");
      modifier += sign * value;
      groups.push({ type: "modifier", value, sign });
      cursor += numberMatch[0].length;
    }
    sign = 1;
    hasTerm = true;
  }
  if (!hasTerm) throw new Error("Не удалось прочитать формулу урона.");
  return groups;
}
function secureDie(sides) {
  if (!crypto?.getRandomValues) throw new Error("Браузер не поддерживает безопасную генерацию случайных чисел.");
  const limit = Math.floor(0x100000000 / sides) * sides;
  const buffer = new Uint32Array(1);
  let value;
  do { crypto.getRandomValues(buffer); value = buffer[0]; } while (value >= limit);
  return (value % sides) + 1;
}
function rollDiceFormula(formula) {
  const groups = parseDiceFormula(formula);
  let total = 0;
  const details = [];
  for (const group of groups) {
    if (group.type === "modifier") {
      total += group.sign * group.value;
      details.push(`${group.sign < 0 ? "−" : "+"} ${group.value}`);
      continue;
    }
    const rolls = Array.from({ length: group.count }, () => secureDie(group.sides));
    const subtotal = rolls.reduce((sum, n) => sum + n, 0) * group.sign;
    total += subtotal;
    details.push(`${group.sign < 0 ? "− " : ""}${group.count}d${group.sides} (${rolls.join(" + ")})`);
  }
  const breakdown = details.join(" ").replace(/^\+\s*/, "").replace(/\s\+\s−/g, " − ");
  return { formula: String(formula), total, details: `${breakdown} = ${total}` };
}
function addRoomRoll(roll) {
  state.roomRolls.unshift(roll);
  state.roomRolls = state.roomRolls.slice(0, 8);
  renderRoomRolls();
}
function renderRoomRolls() {
  const panel = el("rollHistoryPanel");
  const list = el("rollHistory");
  if (!panel || !list) return;
  panel.hidden = state.roomRolls.length === 0;
  list.replaceChildren();
  for (const roll of state.roomRolls) {
    const item = document.createElement("article"); item.className = "roll-entry";
    const title = document.createElement("strong"); title.textContent = `${roll.spellName || "Бросок урона"} · ${roll.formula}`;
    const result = document.createElement("div"); result.className = "roll-entry-result"; result.textContent = `${roll.details || ""}`;
    const meta = document.createElement("div"); meta.className = "roll-entry-meta";
    const who = roll.remote ? "Бросок участника комнаты" : "Ваш бросок";
    meta.textContent = `${who}${roll.damageType ? ` · ${roll.damageType}` : ""}`;
    item.append(title, result, meta); list.append(item);
  }
}
async function performSpellDamageRoll(spell, formula) {
  try {
    const result = rollDiceFormula(formula);
    const roll = {
      kind: "spell-damage-roll",
      spellName: spell.name,
      formula: result.formula,
      total: result.total,
      details: result.details,
      damageType: spell.damageType || "",
      timestamp: Date.now(),
    };
    addRoomRoll(roll);
    if (state.OBR?.notification?.show) {
      try { await state.OBR.notification.show(`${spell.name}: ${result.details}`, "SUCCESS"); } catch { /* уведомление не должно ломать бросок */ }
    }
    if (state.OBR?.broadcast?.sendMessage) {
      try {
        await state.OBR.broadcast.sendMessage(ROLL_CHANNEL, roll, { destination: "REMOTE" });
        setNotice(`Бросок «${spell.name}»: ${result.total}. Результат отправлен участникам комнаты.`, "success");
      } catch (error) {
        setNotice(`Результат: ${result.total}. Не удалось отправить его остальным участникам: ${error.message}`, "error");
      }
    } else {
      setNotice(`Бросок «${spell.name}»: ${result.total}. Вне комнаты результат виден только здесь.`, "success");
    }
  } catch (error) {
    setNotice(`Не удалось бросить кости: ${error.message}`, "error");
  }
}
function addDamageRollSection(parent, spell) {
  const profiles = Array.isArray(spell.damageProfiles) ? spell.damageProfiles.filter(Boolean) : [];
  if (!profiles.length) {
    const fallback = {
      type: spell.damageType || "",
      formula: spell.damageFormula || "",
      atSlotLevel: spell.damageAtSlotLevel || {},
      atCharacterLevel: spell.damageAtCharacterLevel || {},
    };
    if (fallback.formula || Object.keys(fallback.atSlotLevel).length || Object.keys(fallback.atCharacterLevel).length) profiles.push(fallback);
  }
  if (!profiles.length) return;

  const section = document.createElement("section"); section.className = "detail-section damage-section";
  const heading = document.createElement("h3"); heading.textContent = "Бросок урона";
  const description = document.createElement("p"); description.className = "damage-hint";
  description.textContent = "Результат рассчитывается без анимации и отправляется участникам, у которых открыта Книга заклинаний.";
  section.append(heading, description);

  profiles.forEach((profile, index) => {
    const slotEntries = Object.entries(profile.atSlotLevel || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
    const characterEntries = Object.entries(profile.atCharacterLevel || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
    const formulaText = profile.formula || "";
    const profileWrap = document.createElement("div"); profileWrap.className = "damage-profile";
    if (profiles.length > 1 || profile.type) {
      const profileTitle = document.createElement("div"); profileTitle.className = "damage-profile-title";
      profileTitle.textContent = profile.type ? `Урон: ${profile.type}` : `Вариант урона ${index + 1}`;
      profileWrap.append(profileTitle);
    }

    if (slotEntries.length) {
      const row = document.createElement("div"); row.className = "damage-roll-controls";
      const label = document.createElement("label"); label.className = "damage-level-label"; label.textContent = "Уровень ячейки";
      const select = document.createElement("select"); select.className = "damage-level-select";
      slotEntries.forEach(([level, value]) => {
        const option = document.createElement("option"); option.value = level; option.textContent = `${level}-й уровень · ${value}`; select.append(option);
      });
      const defaultLevel = String(Math.max(Number(spell.level) || 1, Number(slotEntries[0][0])));
      if (slotEntries.some(([level]) => level === defaultLevel)) select.value = defaultLevel;
      const rollButton = document.createElement("button"); rollButton.className = "damage-roll-button";
      let selectedFormula = profile.atSlotLevel[select.value];
      const updateButton = () => { selectedFormula = profile.atSlotLevel[select.value]; rollButton.textContent = `🎲 Бросить ${selectedFormula}`; };
      updateButton(); select.addEventListener("change", updateButton);
      rollButton.addEventListener("click", () => performSpellDamageRoll({ ...spell, damageType: profile.type || spell.damageType }, selectedFormula));
      label.append(select); row.append(label, rollButton); profileWrap.append(row);
    } else if (characterEntries.length) {
      const row = document.createElement("div"); row.className = "damage-roll-controls";
      const label = document.createElement("label"); label.className = "damage-level-label"; label.textContent = "Уровень персонажа";
      const select = document.createElement("select"); select.className = "damage-level-select";
      characterEntries.forEach(([level, value]) => {
        const option = document.createElement("option"); option.value = level; option.textContent = `${level}-й уровень · ${value}`; select.append(option);
      });
      const rollButton = document.createElement("button"); rollButton.className = "damage-roll-button";
      let selectedFormula = profile.atCharacterLevel[select.value];
      const updateButton = () => { selectedFormula = profile.atCharacterLevel[select.value]; rollButton.textContent = `🎲 Бросить ${selectedFormula}`; };
      updateButton(); select.addEventListener("change", updateButton);
      rollButton.addEventListener("click", () => performSpellDamageRoll({ ...spell, damageType: profile.type || spell.damageType }, selectedFormula));
      label.append(select); row.append(label, rollButton); profileWrap.append(row);
    } else if (formulaText) {
      const match = formulaText.match(/\d*d\d+(?:\s*[+-]\s*(?:\d*d\d+|\d+))*/i);
      if (!match) return;
      const button = document.createElement("button"); button.className = "damage-roll-button"; button.textContent = `🎲 Бросить ${match[0]}`;
      button.addEventListener("click", () => performSpellDamageRoll({ ...spell, damageType: profile.type || spell.damageType }, match[0]));
      profileWrap.append(button);
    }
    section.append(profileWrap);
  });
  parent.append(section);
}
function levelText(level) { return level === 0 ? "Заговор" : `${level}-й уровень`; }
function populateFilters(spells) {
  const level = el("levelFilter"), cls = el("classFilter"), school = el("schoolFilter");
  const keep = { level: level.value, cls: cls.value, school: school.value };
  const levels = [...new Set(spells.map((s) => Number(s.level) || 0))].sort((a,b) => a-b);
  const classes = [...new Set(spells.flatMap((s) => s.classes || []))].sort((a,b) => a.localeCompare(b, "ru"));
  const schools = [...new Set(spells.map((s) => s.school).filter(Boolean))].sort((a,b) => a.localeCompare(b, "ru"));
  level.innerHTML = '<option value="">Все уровни</option>' + levels.map((n) => `<option value="${n}">${levelText(n)}</option>`).join("");
  cls.innerHTML = '<option value="">Все классы</option>' + classes.map((x) => `<option value="${escapeAttr(x)}">${escapeHtml(x)}</option>`).join("");
  school.innerHTML = '<option value="">Все школы</option>' + schools.map((x) => `<option value="${escapeAttr(x)}">${escapeHtml(x)}</option>`).join("");
  if (levels.includes(Number(keep.level))) level.value = keep.level;
  if (classes.includes(keep.cls)) cls.value = keep.cls;
  if (schools.includes(keep.school)) school.value = keep.school;
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
}
function escapeAttr(value) { return escapeHtml(value).replace(/`/g, "&#96;"); }
function getFiltered() {
  const all = getCurrentSpells();
  const query = el("searchInput").value.trim().toLocaleLowerCase("ru");
  const level = el("levelFilter").value;
  const cls = el("classFilter").value;
  const school = el("schoolFilter").value;
  let filtered = all.filter((spell) => {
    if (level !== "" && Number(spell.level) !== Number(level)) return false;
    if (cls && !(spell.classes || []).includes(cls)) return false;
    if (school && spell.school !== school) return false;
    if (query) {
      const haystack = `${spell.name} ${spell.description} ${spell.school} ${(spell.classes || []).join(" ")}`.toLocaleLowerCase("ru");
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
  const sort = el("sortSelect").value;
  const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });
  filtered.sort((a, b) => {
    if (sort === "level-asc") return a.level - b.level || collator.compare(a.name, b.name);
    if (sort === "level-desc") return b.level - a.level || collator.compare(a.name, b.name);
    if (sort === "class-asc") return collator.compare((a.classes || []).join(", "), (b.classes || []).join(", ")) || collator.compare(a.name,b.name);
    if (sort === "school-asc") return collator.compare(a.school || "", b.school || "") || collator.compare(a.name,b.name);
    if (sort === "name-desc") return collator.compare(b.name, a.name);
    return collator.compare(a.name, b.name);
  });
  return filtered;
}
function renderList() {
  const all = getCurrentSpells();
  const filtered = getFiltered();
  state.visible = filtered;
  el("resultCount").textContent = String(filtered.length);
  el("catalogSource").textContent = `${state.srd.length ? `SRD ${state.edition}` : "МОЯ БИБЛИОТЕКА"}`;
  const list = el("spellList");
  list.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement("div"); empty.className = "no-results";
    empty.textContent = all.length ? "Ничего не найдено. Измени фильтры или поисковый запрос." : "Библиотека пока пуста. Подожди загрузки SRD или импортируй собственный файл.";
    list.append(empty); return;
  }
  const fragment = document.createDocumentFragment();
  filtered.forEach((spell) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `spell-row${spell.id === state.selectedId ? " active" : ""}`;
    const badge = document.createElement("span");
    badge.className = `level-badge${spell.level === 0 ? " cantrip" : ""}`;
    badge.textContent = spell.level === 0 ? "✧" : String(spell.level);
    const main = document.createElement("span"); main.className = "row-main";
    const name = document.createElement("span"); name.className = "row-name"; name.textContent = spell.name;
    const meta = document.createElement("span"); meta.className = "row-meta";
    const school = document.createElement("span"); school.textContent = niceSchool(spell.school);
    const sep = document.createElement("span"); sep.className = "meta-sep"; sep.textContent = "·";
    const cls = document.createElement("span"); cls.textContent = (spell.classes || []).slice(0, 3).join(", ") || "Классы не указаны";
    meta.append(school, sep, cls);
    if (spell.origin !== "srd") {
      const tag = document.createElement("span"); tag.className = "row-custom"; tag.textContent = spell.origin === "draft" ? "· черновик" : "· доп."; meta.append(tag);
    }
    main.append(name, meta); button.append(badge, main);
    button.addEventListener("click", () => { state.selectedId = spell.id; renderList(); renderDetail(spell); });
    fragment.append(button);
  });
  list.append(fragment);
  if (!state.selectedId || !filtered.some((s) => s.id === state.selectedId)) {
    state.selectedId = filtered[0].id;
    renderListSelectionOnly();
    renderDetail(filtered[0]);
  } else {
    const selected = filtered.find((s) => s.id === state.selectedId);
    if (selected) renderDetail(selected);
  }
}
function renderListSelectionOnly() {
  const rows = el("spellList").querySelectorAll(".spell-row");
  rows.forEach((row, i) => row.classList.toggle("active", state.visible[i]?.id === state.selectedId));
}
function addStat(parent, label, value) {
  const cell = document.createElement("div"); cell.className = "stat-cell";
  const lab = document.createElement("span"); lab.className = "stat-label"; lab.textContent = label;
  const val = document.createElement("span"); val.className = "stat-value"; val.textContent = value || "—";
  cell.append(lab, val); parent.append(cell);
}
function addDetailSection(parent, title, body) {
  if (!body) return;
  const section = document.createElement("section"); section.className = "detail-section";
  const h = document.createElement("h3"); h.textContent = title;
  const p = document.createElement("div"); p.className = "description-text";
  String(body).split(/\n\s*\n/).filter(Boolean).forEach((paragraph) => {
    const block = document.createElement("p"); block.textContent = paragraph.trim(); p.append(block);
  });
  section.append(h, p); parent.append(section);
}
function renderDetail(spell) {
  const panel = el("spellDetail"); panel.replaceChildren();
  const wrap = document.createElement("div"); wrap.className = "detail-content";
  const top = document.createElement("div"); top.className = "detail-topline";
  const source = document.createElement("span"); source.className = "detail-source"; source.textContent = spell.source || "Библиотека заклинаний";
  const badge = document.createElement("span"); badge.className = "pill gold"; badge.textContent = levelText(spell.level);
  top.append(source, badge);
  const title = document.createElement("h2"); title.className = "detail-title"; title.textContent = spell.name;
  const sub = document.createElement("div"); sub.className = "detail-subtitle";
  const school = document.createElement("span"); school.className = "pill"; school.textContent = niceSchool(spell.school);
  sub.append(school);
  if (spell.ritual) { const p = document.createElement("span"); p.className = "pill"; p.textContent = "Ритуал"; sub.append(p); }
  if (spell.concentration) { const p = document.createElement("span"); p.className = "pill"; p.textContent = "Концентрация"; sub.append(p); }
  const stats = document.createElement("div"); stats.className = "stat-grid";
  addStat(stats, "Время накладывания", spell.castingTime);
  addStat(stats, "Дальность", spell.range);
  addStat(stats, "Компоненты", (spell.components || []).join(", ") + (spell.material ? ` · ${spell.material}` : ""));
  addStat(stats, "Длительность", spell.duration + (spell.concentration ? " (концентрация)" : ""));
  wrap.append(top, title, sub, stats);
  addDamageRollSection(wrap, spell);
  if (spell.classes?.length) {
    const sec = document.createElement("section"); sec.className = "detail-section";
    const h = document.createElement("h3"); h.textContent = "Доступно классам";
    const chips = document.createElement("div"); chips.className = "class-chips";
    spell.classes.forEach((x) => { const chip = document.createElement("span"); chip.className = "class-chip"; chip.textContent = x; chips.append(chip); });
    sec.append(h, chips); wrap.append(sec);
  }
  addDetailSection(wrap, "Описание", spell.description);
  addDetailSection(wrap, "На более высоких уровнях", spell.higherLevel);
  const safeSourceUrl = safeHttpUrl(spell.sourceUrl);
  if (safeSourceUrl) {
    const link = document.createElement("a"); link.className = "detail-link"; link.href = safeSourceUrl; link.target = "_blank"; link.rel = "noopener"; link.textContent = "Открыть источник заклинания ↗"; wrap.append(link);
  }
  panel.append(wrap);
}
function rebuild() {
  const spells = getCurrentSpells();
  populateFilters(spells);
  renderList();
}
function resetFilters() {
  el("searchInput").value = ""; el("levelFilter").value = ""; el("classFilter").value = ""; el("schoolFilter").value = ""; el("sortSelect").value = "name-asc";
  rebuild();
}
function bindEvents() {
  ["searchInput", "levelFilter", "classFilter", "schoolFilter", "sortSelect"].forEach((id) => {
    el(id).addEventListener(id === "searchInput" ? "input" : "change", () => { state.selectedId = null; renderList(); });
  });
  el("resetFilters").addEventListener("click", resetFilters);
  el("editionSelect").addEventListener("change", async (event) => {
    state.edition = event.target.value;
    state.selectedId = null;
    state.srd = [];
    await loadSrd(state.edition);
  });
  el("refreshSrd").addEventListener("click", async () => {
    await loadPublishedCustom();
    await loadSrd(state.edition, true);
    setNotice(`Каталог обновлён. SRD: ${state.srd.length}, пользовательских заклинаний: ${state.publishedCustom.length}.`, "success");
  });
  el("spellFileInput").addEventListener("change", (event) => {
    const file = event.target.files?.[0]; if (file) importFile(file);
  });
  el("exportCustom").addEventListener("click", exportPublishedFile);
  el("clearDraft").addEventListener("click", clearDraft);
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault(); el("searchInput").focus();
    }
  });
}

async function init() {
  bindEvents();
  await connectToOwlbear();
  loadDraft();
  await loadPublishedCustom();
  rebuild();
  await loadSrd(state.edition);
  rebuild();
  if (isGM() && state.draft.length) setAdminStatus(`Восстановлен локальный черновик: ${state.draft.length} заклинаний. Для игроков скачай и опубликуй custom-spells.json.`);
}

init().catch((error) => {
  console.error(error);
  setNotice(`Ошибка запуска расширения: ${error.message}`, "error");
});
