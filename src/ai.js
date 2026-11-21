// Gemini: answer questions about the budget, read receipts, and turn free text into proposed actions.
// The client sends a compact context (numbers computed by the engine), so the model never does the maths.

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    answer: { type: 'STRING', description: 'Short reply to the user, plain text, at most 3 sentences.' },
    actions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          type: { type: 'STRING', enum: ['add_txn', 'add_plan', 'add_goal'] },
          name: { type: 'STRING' },
          amount: { type: 'NUMBER', description: 'In currency units. Negative = money out, positive = income. For tab/budget: amount per unit.' },
          date: { type: 'STRING', description: 'YYYY-MM-DD, for add_txn' },
          category: { type: 'STRING', description: 'Exact name of one of the user categories' },
          tags: { type: 'ARRAY', items: { type: 'STRING' } },
          nature: { type: 'STRING', enum: ['fixed', 'everyday', 'spontaneous', 'planned'] },
          kind: { type: 'STRING', enum: ['once', 'repeat', 'budget', 'tab'] },
          unit: { type: 'STRING', enum: ['day', 'week', 'month', 'year'] },
          every: { type: 'INTEGER' },
          times: { type: 'INTEGER' },
          start: { type: 'STRING', description: 'YYYY-MM-DD' },
          end: { type: 'STRING', description: 'YYYY-MM-DD' },
          settle_on: { type: 'STRING', description: 'YYYY-MM-DD, tab only: first (or only) payoff date' },
          settle_every: { type: 'STRING', enum: ['week', 'month'], description: 'tab only: when the debt is paid off repeatedly from settle_on' },
          target: { type: 'NUMBER', description: 'add_goal only' },
          target_date: { type: 'STRING', description: 'add_goal only' },
          note: { type: 'STRING' },
        },
        required: ['type'],
      },
    },
  },
  required: ['answer', 'actions'],
};

function systemPrompt({ today, currency, categories, tags }) {
  return [
    'You are the assistant inside "purse", a personal budgeting app. Today is ' + today + '. Currency: ' + currency + '.',
    'Reply with JSON matching the schema: a short plain-text "answer" and zero or more proposed "actions" the user will confirm.',
    'Actions: add_txn = money that already moved (date in the past or today). add_plan = money that will move:',
    '  kind once (single future amount, start = its date), repeat (every N unit from start, optional end or times),',
    '  budget (flexible allowance: amount per unit, e.g. groceries 300 per month), tab (a debt accruing amount per unit since start,',
    '  e.g. unpaid rent 20 per day since a date, optional settle_on when it gets paid, settle_every month/week if paid off repeatedly). add_goal = savings target.',
    'Spending amounts are negative, income positive. Use only these category names: ' + categories.join(', ') + '.',
    'Existing tags: ' + (tags.join(', ') || 'none') + '. Prefer existing tags; tags are lowercase single words.',
    'For a receipt image: one add_txn with the total paid (negative), merchant as name, the receipt date (or today if unreadable),',
    '  the best category, and a note listing the main items briefly. If the receipt is in another currency, say so in the answer.',
    'For questions: answer from the context numbers only; never invent figures. If the context lacks the data, say what is missing.',
    'Never propose actions for a pure question. Keep answers brief and concrete, with amounts formatted like 1,234.50.',
  ].join('\n');
}

export async function askGemini(env, { text, image, mime, context, today, currency, categories, tags }) {
  const parts = [];
  if (context) parts.push({ text: 'Budget context (JSON, computed by the app):\n' + JSON.stringify(context).slice(0, 40000) });
  if (image) parts.push({ inline_data: { mime_type: mime, data: image } });
  parts.push({ text: text || (image ? 'Read this receipt.' : '') });
  const model = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt({ today, currency, categories, tags }) }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.2, maxOutputTokens: 4096,
        // long thinking made answers take minutes and ran out of tokens; extraction needs little of it
        ...(/gemini-[3-9]/.test(model) ? { thinkingConfig: { thinkingLevel: env.GEMINI_THINKING || 'minimal' } } : {}),
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.error && data.error.message) || 'Gemini request failed (' + res.status + ').';
    const err = new Error(res.status === 429 ? 'Gemini free quota reached for now. Try again later.' : msg);
    err.status = res.status === 429 ? 429 : 502;
    throw err;
  }
  const txt = (((data.candidates || [])[0] || {}).content || {}).parts?.map((p) => p.text || '').join('') || '';
  try {
    const out = JSON.parse(txt);
    return { answer: String(out.answer || ''), actions: Array.isArray(out.actions) ? out.actions.slice(0, 10) : [] };
  } catch {
    return { answer: txt.slice(0, 1000) || 'No answer.', actions: [] };
  }
}
