// ══════════════════════════════════════════════════════════════
//  YouTube Smart Lock — AI AI Bridge (Main World)
// ══════════════════════════════════════════════════════════════
//  Runs in the MAIN world to access the global LanguageModel API,
//  which is blocked in the extension's isolated world.
// ══════════════════════════════════════════════════════════════

window.addEventListener("message", async (event) => {
    // Only accept messages from our own extension's content script
    if (event.source !== window || !event.data || !event.data.type) {
        return;
    }

    if (event.data.type === "FITLOCK_PAUSE_VIDEO") {
        const p = document.querySelector('#movie_player');
        if (p && typeof p.pauseVideo === 'function') { p.pauseVideo(); }
        return;
    }

    if (event.data.type === "FITLOCK_PLAY_VIDEO") {
        const p = document.querySelector('#movie_player');
        if (p && typeof p.playVideo === 'function') { p.playVideo(); }
        return;
    }

    if (event.data.type !== "FITLOCK_AI_REQUEST") {
        return;
    }

    const { id, title, description } = event.data;

    // Check if the new Global Constructor exists or the old window.ai namespace
    let createModelSession;
    if (typeof LanguageModel !== "undefined" && typeof LanguageModel.create === "function") {
        createModelSession = LanguageModel.create.bind(LanguageModel);
    } else if (typeof window.ai !== "undefined" && window.ai?.languageModel?.create) {
        createModelSession = window.ai.languageModel.create.bind(window.ai.languageModel);
    } else {
        window.postMessage({
            type: "FITLOCK_AI_RESPONSE",
            id,
            error: "Neither Global LanguageModel nor window.ai is available in the Main page context. Built-in AI API is missing."
        }, "*");
        return;
    }

    try {
        const session = await createModelSession({
            initialPrompts: [
                {
                    role: "system",
                    content: `You are a strict productivity analyzer. Determine if a video is "Productive" or a "Distraction" based on its title and description. 

Classify as Productive if it relates to: Mathematics, Computer Science, Artificial Intelligence, machine learning, robotics, the space industry, Swift iOS app development, combinatorics, evolution, or fitness and gym training.

Classify as Distraction if it relates to: Game of Thrones, House of the Dragon, Curb Your Enthusiasm, superhero/Marvel media, video games like Minecraft, board games, or fantasy basketball.

Respond only in raw JSON format: {"isProductive": boolean, "category": "string", "reasoning": "short explanation"}`
                }
            ],
            expectedInputLanguages: ["en"],
            expectedOutputLanguages: ["en"],
        });

        const prompt = `Title: ${title}\nDescription: ${description}`;
        const rawResponse = await session.prompt(prompt);

        window.postMessage({
            type: "FITLOCK_AI_RESPONSE",
            id,
            rawResponse
        }, "*");
    } catch (err) {
        window.postMessage({
            type: "FITLOCK_AI_RESPONSE",
            id,
            error: err.message || String(err)
        }, "*");
    }
});
