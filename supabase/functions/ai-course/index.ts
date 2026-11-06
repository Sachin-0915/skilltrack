// SkillTrack - AI course generator (Supabase Edge Function)
// Deploy in Supabase: Edge Functions > Deploy a new function > Via Editor > name it "ai-course" > paste this file.
// Needs one secret: ANTHROPIC_API_KEY (Edge Functions > Secrets). The key never reaches the browser.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MAX_SOURCE_CHARS = 40000;

// The shape Claude must return (structured output, validated by the API).
const courseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "duration_minutes", "lessons", "questions"],
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    duration_minutes: { type: "integer" },
    lessons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "content"],
        properties: { title: { type: "string" }, content: { type: "string" } },
      },
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "options", "correct", "explanation"],
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          correct: { type: "integer" },
          explanation: { type: "string" },
        },
      },
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });

  // 1. Only HR admins (or the Super Admin) may generate courses.
  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const [{ data: role }, { data: isSuper }] = await Promise.all([sb.rpc("my_role"), sb.rpc("is_super_admin")]);
  if (role !== "org_admin" && !isSuper) return reply(403, { error: "Only HR admins can create courses with AI." });

  // 2. Read and check the request.
  let input: Record<string, unknown>;
  try { input = await req.json(); } catch { return reply(400, { error: "Invalid request." }); }
  const topic = String(input.topic ?? "").trim().slice(0, 200);
  const audience = String(input.audience ?? "All employees").slice(0, 100);
  const level = String(input.level ?? "Beginner").slice(0, 30);
  const lessons = Math.min(6, Math.max(2, Number(input.lessons) || 4));
  const questions = Math.min(10, Math.max(3, Number(input.questions) || 5));
  const source = String(input.source ?? "").trim();
  if (!topic && !source) return reply(400, { error: "Enter a topic or paste some source material." });
  if (source.length > MAX_SOURCE_CHARS) {
    return reply(400, { error: `The source material is too long (${source.length.toLocaleString()} characters). Please paste at most ${MAX_SOURCE_CHARS.toLocaleString()} characters, for example one policy section at a time.` });
  }

  const prompt = `Create a workplace training course as structured data.

Topic: ${topic || "(take it from the source material)"}
Audience: ${audience}
Level: ${level}
Number of lessons: exactly ${lessons}
Number of quiz questions: exactly ${questions}

Lesson content rules:
- Plain text only, no markdown headings or bold. Separate paragraphs with a blank line. Short lists may use lines starting with "- ".
- 150 to 300 words per lesson, practical and specific to the audience, with an everyday workplace example.

Quiz rules:
- Each question has exactly 4 options; "correct" is the 0-based index of the right option.
- Test understanding of the lessons, not trivia. Vary which position holds the correct answer.
- "explanation" says in one sentence why the answer is right.

"duration_minutes" is a realistic estimate for reading the lessons and taking the quiz.
${source ? `\nBuild the course ONLY from the source material below. Do not add facts, numbers or rules that are not in it.\n\n<source_material>\n${source}\n</source_material>` : ""}`;

  // 3. Ask Claude.
  try {
    const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
    const msg = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: courseSchema } },
      system: "You are an expert instructional designer who writes clear, accurate corporate training for an LMS.",
      messages: [{ role: "user", content: prompt }],
    } as any);

    if (msg.stop_reason === "refusal") return reply(422, { error: "The AI could not create this course. Please rephrase the topic or source material." });
    if (msg.stop_reason === "max_tokens") return reply(422, { error: "The course came out too long. Try fewer lessons or shorter source material." });
    const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const course = JSON.parse(text);

    // Light clean-up so bad data never reaches the database.
    course.lessons = (course.lessons ?? []).filter((l: any) => l.title && l.content);
    course.questions = (course.questions ?? []).filter((q: any) =>
      q.question && Array.isArray(q.options) && q.options.length === 4 && q.correct >= 0 && q.correct <= 3);
    if (!course.lessons.length) return reply(422, { error: "The AI returned no usable lessons. Please try again." });
    return reply(200, { course });
  } catch (err) {
    console.error(err);
    const status = (err as any)?.status;
    if (status === 401) return reply(500, { error: "The AI key is missing or wrong. Check the ANTHROPIC_API_KEY secret in Supabase." });
    if (status === 429) return reply(429, { error: "The AI is busy right now. Please try again in a minute." });
    if (status === 400 && /credit/i.test(String((err as any)?.message))) return reply(402, { error: "The Anthropic account is out of credit. Add credit at console.anthropic.com." });
    return reply(500, { error: "Something went wrong while generating the course. Please try again." });
  }
});
