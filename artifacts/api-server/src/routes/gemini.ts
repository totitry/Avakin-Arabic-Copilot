import { Router, type IRouter } from "express";
import { GenerateGeminiRepliesBody } from "@workspace/api-zod";

const router: IRouter = Router();

const MODEL = "gemini-3.7-flash";
const QUOTA_MESSAGE = "خلص الحد المجاني للذكاء الاصطناعي حاليًا جرب مرة ثانية لاحقًا";
const UNAVAILABLE_MESSAGE = "تعذر الوصول إلى الذكاء الاصطناعي حاليًا. ستبقى أدواتك المحلية متاحة.";

type GeminiCandidate = {
  content?: {
    parts?: Array<{ text?: string }>;
  };
};

type GeminiResponse = {
  candidates?: GeminiCandidate[];
};

const normalizeReply = (value: unknown) =>
  typeof value === "string"
    ? value.replace(/\s+/g, " ").trim()
    : "";

router.post("/gemini/generate-replies", async (req, res) => {
  const parsed = GenerateGeminiRepliesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات الرسالة غير مكتملة." });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "أضف مفتاح Gemini من إعدادات البيئة لتفعيل الاقتراحات الذكية." });
    return;
  }

  const { message, recentMessages, dialect, dialectStrength, mode, personality } =
    parsed.data;

  const prompt = [
    "أنت مساعد ردود عربية لتطبيق محادثات داخل لعبة Avakin Life.",
    "اكتب ثلاثة ردود مختلفة فعلاً لنفس الرسالة، لا تعيد صياغة الرد نفسه.",
    "التزم بالشخصية واللهجة، واجعل الردود طبيعية ومناسبة وآمنة.",
    "لا تستخدم شروحات أو عناوين أو علامات اقتباس داخل النص.",
    "لا ترسل أو تنفذ أي شيء داخل اللعبة. أعد JSON صالحاً فقط بالشكل {\"suggestions\":[{\"text\":\"...\",\"style\":\"متوازن\"},{\"text\":\"...\",\"style\":\"مباشر\"},{\"text\":\"...\",\"style\":\"خفيف\"}]}.",
    `اللهجة: ${dialect}، قوة اللهجة: ${dialectStrength}%، النمط: ${mode}.`,
    `الشخصية: ${JSON.stringify({
      name: personality.name,
      description: personality.description,
      warmth: personality.warmth,
      humor: personality.humor,
      confidence: personality.confidence,
      directness: personality.directness,
      playfulness: personality.playfulness,
      responseLength: personality.responseLength,
      preferredWords: personality.preferredWords.slice(0, 12),
      blockedWords: personality.blockedWords.slice(0, 12),
    })}`,
    `السياق القريب: ${JSON.stringify(recentMessages.slice(-8))}`,
    `الرسالة الجديدة: ${message}`,
  ].join("\n");

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.85,
            responseMimeType: "application/json",
          },
        }),
        signal: AbortSignal.timeout(15000),
      },
    );

    if (response.status === 429) {
      res.status(429).json({ error: QUOTA_MESSAGE });
      return;
    }

    if (!response.ok) {
      res.status(502).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    const payload = (await response.json()) as GeminiResponse;
    const rawText = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim();

    if (!rawText) {
      res.status(502).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    const jsonText = rawText.replace(/^```json\s*/i, "").replace(/\s*```$/, "");
    const decoded = JSON.parse(jsonText) as {
      suggestions?: Array<{ text?: unknown; style?: unknown }>;
    };
    const styles = ["متوازن", "مباشر", "خفيف"] as const;
    const suggestions = (decoded.suggestions ?? [])
      .slice(0, 3)
      .map((item, index) => ({
        text: normalizeReply(item.text),
        style: styles[index],
      }))
      .filter((item) => item.text.length > 0);
    const uniqueTexts = new Set(suggestions.map((item) => item.text.toLocaleLowerCase()));

    if (suggestions.length !== 3 || uniqueTexts.size !== 3) {
      res.status(502).json({ error: "وصل رد غير مكتمل من الذكاء الاصطناعي. بقيت الردود المحلية متاحة." });
      return;
    }

    res.json({ suggestions });
  } catch {
    res.status(502).json({ error: UNAVAILABLE_MESSAGE });
  }
});

export default router;