// ── Local AI Server Configurations ──
const LOCAL_AI_SERVERS = {
  ollama: {
    name: "Ollama",
    baseUrl: "http://localhost:11434",
    listModelsEndpoint: "/api/tags",
    parseModels: (data) => (data.models || []).map(m => m.name),
    chatEndpoint: "/api/chat",
    buildChatBody: (model, systemPrompt, userPrompt) => ({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      stream: false,
      options: { temperature: 0 }
    }),
    parseResponse: (data) => data.message?.content || "",
  },
  lmstudio: {
    name: "LM Studio",
    baseUrl: "http://localhost:1234",
    listModelsEndpoint: "/v1/models",
    parseModels: (data) => (data.data || []).map(m => m.id),
    chatEndpoint: "/v1/chat/completions",
    buildChatBody: (model, systemPrompt, userPrompt) => ({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0,
      stream: false
    }),
    parseResponse: (data) => data.choices?.[0]?.message?.content || "",
  },
  gpt4all: {
    name: "GPT4All",
    baseUrl: "http://localhost:4891",
    listModelsEndpoint: "/v1/models",
    parseModels: (data) => (data.data || []).map(m => m.id),
    chatEndpoint: "/v1/chat/completions",
    buildChatBody: (model, systemPrompt, userPrompt) => ({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0,
      stream: false
    }),
    parseResponse: (data) => data.choices?.[0]?.message?.content || "",
  }
};

// ── AI Backend Detection ──
// Best-effort hint from the service worker. NOTE: Chrome's built-in AI APIs
// (self.ai.languageModel / LanguageModel) are typically NOT available in service
// workers — they only exist in page/main-world contexts. The content script
// should probe the main-world bridge (FITLOCK_CHECK_AI) for authoritative
// detection. This function is kept as a fallback hint and will be overridden
// by the user's preferredAiBackend setting when set.
export async function detectAIBackend() {
  try {
    if (typeof self.ai !== "undefined" && self.ai?.languageModel) {
      const caps = await self.ai.languageModel.capabilities();
      if (caps && caps.available === "readily") return "gemini";
    }
  } catch { }
  return "ollama";
}

// ── Default Prompt ──
export const DEFAULT_YOUTUBE_PROMPT = `You are a productivity analyzer. Your job is to determine whether a YouTube video is "Productive" or a "Distraction" based PRIMARILY on its title. The description may be stale or missing — if the title clearly indicates the topic, trust the title.

Think about the INTENT and NATURE of the content, not just the topic:

Classify as PRODUCTIVE if the video is genuinely informational, educational, or intellectually enriching — regardless of specific subject. This includes (but is NOT limited to):
- Any academic or educational subject: history, economics, science, geography, philosophy, law, politics, literature, linguistics
- News, current events, world affairs, and journalism
- Technology, programming, AI, math, engineering, medicine, biology
- Fitness, nutrition, sports training, and physical wellness
- How-to guides, tutorials, skill-building, and instructional content
- Documentaries, explainer videos, lectures, talks, and interviews that inform
- Finance, investing, personal development, and career growth
- Culture, art history, or analysis that deepens understanding

Classify as DISTRACTION if the content is primarily for passive entertainment, amusement, or time-killing with little to no informational value. This includes:
- TV shows, movies, series, anime, cartoons, and animated shows
- Drama, reality TV, celebrity gossip, and entertainment news
- Comedy sketches, memes, reaction videos, and viral content
- Music videos (unless educational about music theory or history)
- Gaming streams or Let's Plays (unless educational about game design/programming)
- Fan content, shipping, or fandom-related videos
- Prank videos, challenge videos, or content designed purely for shock/amusement

When in doubt: ask yourself "Does watching this leave the viewer meaningfully more informed or skilled?" If yes → Productive. If it's purely for entertainment → Distraction.

Respond only in raw JSON format: {"isProductive": boolean, "category": "string", "reasoning": "short explanation"}`;

// ── Local AI Integration ──
export async function localAiInference(title, description) {
  const data = await chrome.storage.local.get(["localAiModel", "localAiServer", "youtubePrompt"]);
  const model = data.localAiModel;
  const serverKey = data.localAiServer || "ollama";
  const server = LOCAL_AI_SERVERS[serverKey];
  const systemPrompt = data.youtubePrompt || DEFAULT_YOUTUBE_PROMPT;

  if (!model) throw new Error("No model selected. Configure one in FitLock settings.");
  if (!server) throw new Error(`Unknown AI server: ${serverKey}`);

  const userPrompt = `Title: ${title}\nDescription: ${description}`;

  const res = await fetch(`${server.baseUrl}${server.chatEndpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(server.buildChatBody(model, systemPrompt, userPrompt))
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown error");
    throw new Error(`${server.name} inference failed (${res.status}): ${errText}`);
  }

  const result = await res.json();
  return server.parseResponse(result);
}

export async function checkLocalAiStatus(serverKey = "ollama") {
  const server = LOCAL_AI_SERVERS[serverKey];
  if (!server) return { available: false, models: [], error: "unknown-server" };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(`${server.baseUrl}${server.listModelsEndpoint}`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });

    if (!res.ok) {
      return { available: false, models: [], error: `http-${res.status}` };
    }

    const data = await res.json();
    return { available: true, models: server.parseModels(data) };
  } catch (err) {
    return {
      available: false,
      models: [],
      error: err?.name === "AbortError" ? "timeout" : "connection",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
