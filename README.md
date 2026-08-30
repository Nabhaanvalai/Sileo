<p align="center">
  <img src="Resources/AppIcon-Source.png" width="128" height="128" alt="Sileo icon">
</p><h1 align="center">Sileo</h1><p align="center">
  Free and open source alternative to <a href="https://wisprflow.ai">Wispr Flow</a>, <a href="https://superwhisper.com">Superwhisper</a>, and <a href="https://monologue.to">Monologue</a>.
</p><p align="center">
  <a href="https://github.com/sileo-app/sileo/releases/latest/download/Sileo-Setup.exe"><b>⬇ Download Sileo-Setup.exe</b></a><br>
  <sub>Works on Windows 10 and 11</sub>
</p>---

<p align="center">
  <img src="Resources/demo.gif" alt="Sileo demo" width="600">
</p><p align="center">
  <i>Created and maintained by Nabhan.</i>
</p>Overview

Sileo is a free Windows dictation app inspired by Wispr Flow, Superwhisper, and Monologue. It provides fast AI transcription, context-aware cleanup, and voice-driven text editing without requiring a monthly subscription.

Quick Start

1. Download and install Sileo.
2. Get a free Groq API key from <a href="https://groq.com/">Groq</a>.
3. Press "F9" to start and stop dictation.
4. Your speech will be transcribed and pasted into the current text field.

Features

- Custom shortcuts: Configure hold-to-talk and toggle dictation shortcuts.
- Context-aware cleanup: Sileo can read nearby application context so names, terms, and phrases are spelled correctly.
- Custom vocabulary: Add names, jargon, and project-specific terminology.
- OpenAI-compatible providers: Use Groq by default or configure a custom model and API URL.
- Edit Mode: Select existing text and transform it using spoken instructions such as "make this shorter" or "turn this into bullets."
- Local models: Use OpenAI-compatible local or self-hosted providers such as Ollama and LM Studio.

Privacy

Sileo does not operate a server that stores or retains your data. Information leaves your computer only through API calls to the transcription and LLM providers you configure.

Screen context is optional and may include active-window metadata, selected text, and screenshots. Disable context-aware features when working with sensitive information.

Provider Configuration

Sileo uses Groq by default through its OpenAI-compatible API.

In Settings → Provider, configure:

- Provider API base URL
- API key
- Transcription model
- Cleanup model

The default API base URL is:

"https://api.groq.com/openai/v1"

Local or self-hosted OpenAI-compatible services can also be configured.

Custom Cleanup

Sileo allows you to customize how dictated text is cleaned up.

The cleanup system can:

- Remove filler words.
- Fix spelling, grammar, and punctuation.
- Correct close misspellings using context or custom vocabulary.
- Preserve the speaker's intent, tone, and meaning.
- Return only the cleaned transcript.

Using a Local Model

Sileo supports OpenAI-compatible local and self-hosted AI providers.

Examples include:

- Ollama
- LM Studio
- Other OpenAI-compatible servers

Local models can provide additional privacy, although performance depends on your hardware and the model being used.

License

Sileo is free and open source.

---

<p align="center">
  <b>Sileo</b> — Built and maintained by KT.
</p>