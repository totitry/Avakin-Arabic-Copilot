import { Router, type IRouter } from "express";
import {
  GenerateGeminiRepliesBody,
  GenerateGeminiRepliesResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const MODEL = "gemini-3.7-flash";
const QUOTA_MESSAGE = "خلص الحد المجاني للذكاء الاصطناعي حاليًا جرب مرة ثانية لاحقًا";
const UNAVAILABLE_MESSAGE = "تعذر الوصول إلى الذكاء الاصطناعي حاليًا. ستبقى أدواتك المحلية متاحة.";
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_REQUESTS = 20;
const MAX_CROP_IMAGE_BYTES = 300_000;
const requestBuckets = new Map<string, { count: number; resetAt: number }>();

type GeminiCandidate = {
  content?: {
    parts?: Array<{ text?: string; inlineData?: { mimeType?: string; data?: string } }>;
  };
};

type GeminiResponse = {
  candidates?: GeminiCandidate[];
};

const normalizeReply = (value: unknown) =>
  typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, 500)
    : "";

type CropImage = {
  mimeType: "image/jpeg" | "image/png";
  base64: string;
};

const parseCropImage = (dataUrl: string | undefined): CropImage | null => {
  if (!dataUrl) {
    return null;
  }

  const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
  if (!match || match[2].length === 0 || match[2].length % 4 !== 0) {
    return null;
  }

  const base64 = match[2];
  const bytes = Buffer.from(base64, "base64");
  if (
    bytes.length === 0 ||
    bytes.length > MAX_CROP_IMAGE_BYTES ||
    bytes.toString("base64") !== base64
  ) {
    return null;
  }

  return {
    mimeType: match[1] === "jpeg" ? "image/jpeg" : "image/png",
    base64,
  };
};

const responseSchema = {
  type: "OBJECT",
  properties: {
    suggestions: {
      type: "ARRAY",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "OBJECT",
        properties: {
          text: { type: "STRING" },
          style: { type: "STRING", enum: ["متوازن", "مباشر", "خفيف"] },
        },
        required: ["text", "style"],
      },
    },
    detectedMessages: {
      type: "ARRAY",
      maxItems: 30,
      items: {
        type: "OBJECT",
        properties: {
          speaker: { type: "STRING" },
          text: { type: "STRING" },
          isNew: { type: "BOOLEAN" },
          confidence: { type: "NUMBER" },
        },
        required: ["speaker", "text", "isNew", "confidence"],
      },
    },
    targetPlayer: { type: "STRING" },
  },
  required: ["suggestions"],
};

router.post("/gemini/generate-replies", async (req, res): Promise<void> => {
  const parsed = GenerateGeminiRepliesBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn("Invalid Gemini reply request body");
    res.status(400).json({ error: "بيانات الرسالة غير مكتملة." });
    return;
  }

  const cropImage = parseCropImage(parsed.data.cropImageDataUrl);
  if (parsed.data.cropImageDataUrl && !cropImage) {
    req.log.warn("Invalid or oversized Gemini chat crop");
    res.status(400).json({ error: "صورة قص المحادثة غير صالحة أو كبيرة جدًا." });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    req.log.warn("Gemini API key is not configured");
    res.status(503).json({ error: "أضف مفتاح Gemini من إعدادات البيئة لتفعيل الاقتراحات الذكية." });
    return;
  }

  const key = req.ip || "unknown";
  const currentTime = Date.now();
  const existingBucket = requestBuckets.get(key);
  const bucket = !existingBucket || existingBucket.resetAt <= currentTime
    ? { count: 0, resetAt: currentTime + RATE_LIMIT_WINDOW_MS }
    : existingBucket;
  bucket.count += 1;
  requestBuckets.set(key, bucket);
  if (bucket.count > RATE_LIMIT_REQUESTS) {
    req.log.warn("Gemini reply rate limit exceeded");
    res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - currentTime) / 1000)));
    res.status(429).json({ error: QUOTA_MESSAGE });
    return;
  }

  const {
    message,
    avakinUsername,
    focusedPlayer,
    globalSummary,
    playerSummary,
    recentMessages,
    newMessages,
    localOcrText,
    localOcrConfidence,
    dialect,
    dialectStrength,
    mode,
    personality,
  } =
    parsed.data;

  const prompt = [
    "أنت مساعد ردود عربية لتطبيق محادثات داخل لعبة Avakin Life.",
    "اكتب ثلاثة ردود مختلفة فعلاً لنفس الرسالة، لا تعيد صياغة الرد نفسه.",
    "التزم بالشخصية واللهجة، واجعل الردود طبيعية ومناسبة وآمنة.",
    "لا تستخدم شروحات أو عناوين أو علامات اقتباس داخل النص.",
    "لا ترسل أو تنفذ أي شيء داخل اللعبة.",
    cropImage
      ? "حلّل صورة منطقة المحادثة المرفقة فقط. انسخ الرسائل المرئية بترتيبها من الأقدم إلى الأحدث، وحدد isNew=true فقط للرسائل الجديدة فعلًا مقارنة بالمحادثة الحديثة. حدّد targetPlayer إن كان واضحًا من الرسائل الجديدة."
      : "لا توجد صورة مرفقة؛ أنشئ الاقتراحات من النص والسياق فقط.",
    "أعد JSON صالحاً فقط يحتوي suggestions بثلاثة عناصر بالضبط، ويمكن أن يحتوي detectedMessages (speaker,text,isNew,confidence من 0 إلى 1) وtargetPlayer.",
    `اللهجة: ${dialect}، قوة اللهجة: ${dialectStrength}%، النمط: ${mode}.`,
    `هوية المستخدم في Avakin: ${avakinUsername || "غير محددة"}.`,
    `اللاعب المركّز: ${focusedPlayer || "لا يوجد"}.`,
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
    `ملخص الغرفة الأقدم: ${globalSummary || "لا يوجد بعد"}.`,
    `ملخص اللاعب المركّز: ${playerSummary || "لا يوجد بعد"}.`,
    `المحادثة المرتبة الحديثة: ${JSON.stringify(recentMessages.slice(-30))}`,
    `الرسائل الجديدة: ${JSON.stringify(newMessages.slice(-8))}`,
    localOcrText
      ? `نص OCR المحلي (قد يكون غير دقيق، الثقة ${localOcrConfidence ?? "غير معروفة"}): ${localOcrText}`
      : "",
    `الرسالة المستهدفة: ${message}`,
  ].filter(Boolean).join("\n");

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{
              role: "user",
              parts: [
                { text: prompt },
                ...(cropImage
                  ? [{ inlineData: { mimeType: cropImage.mimeType, data: cropImage.base64 } }]
                  : []),
              ],
            }],
          generationConfig: {
            temperature: 0.85,
            responseMimeType: "application/json",
              responseSchema,
          },
        }),
        signal: AbortSignal.timeout(15000),
      },
    );

    if (response.status === 429) {
      req.log.warn("Gemini provider quota was exhausted");
      res.status(429).json({ error: QUOTA_MESSAGE });
      return;
    }

    if (!response.ok) {
      req.log.warn({ statusCode: response.status }, "Gemini reply request failed");
      res.status(502).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    const payload = (await response.json()) as GeminiResponse;
    const rawText = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim();

    if (!rawText) {
      req.log.warn("Gemini reply response had no text");
      res.status(502).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    let decoded: {
      suggestions?: Array<{ text?: unknown; style?: unknown }>;
      detectedMessages?: unknown;
      targetPlayer?: unknown;
    };
    try {
      const jsonText = rawText.replace(/^```json\s*/i, "").replace(/\s*```$/, "");
      decoded = JSON.parse(jsonText) as typeof decoded;
    } catch {
      req.log.warn("Gemini reply response was not JSON");
      res.status(502).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

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
      req.log.warn("Gemini reply response had malformed suggestions");
      res.status(502).json({ error: "وصل رد غير مكتمل من Gemini. تم حفظ المحادثة، لكن لم يتم إنشاء ردود لهذه الرسالة." });
      return;
    }

    const detectedMessages = Array.isArray(decoded.detectedMessages)
      ? decoded.detectedMessages
        .slice(0, 30)
        .map((item) => {
          if (!item || typeof item !== "object") {
            return null;
          }
          const message = item as Record<string, unknown>;
          const speaker = normalizeReply(message.speaker).slice(0, 64);
          const text = normalizeReply(message.text).slice(0, 1000);
          const confidence = message.confidence;
          return speaker &&
            text &&
            typeof message.isNew === "boolean" &&
            typeof confidence === "number" &&
            Number.isFinite(confidence) &&
            confidence >= 0 &&
            confidence <= 1
            ? { speaker, text, isNew: message.isNew, confidence }
            : null;
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
      : undefined;
    const targetPlayer = typeof decoded.targetPlayer === "string"
      ? normalizeReply(decoded.targetPlayer).slice(0, 64)
      : undefined;
    const normalizedResponse = GenerateGeminiRepliesResponse.safeParse({
      suggestions,
      ...(detectedMessages ? { detectedMessages } : {}),
      ...(targetPlayer ? { targetPlayer } : {}),
    });
    if (!normalizedResponse.success) {
      req.log.warn("Gemini reply response failed output validation");
      res.status(502).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    res.json(normalizedResponse.data);
  } catch (error) {
    req.log.warn({ err: error }, "Gemini reply request was unavailable");
    res.status(502).json({ error: UNAVAILABLE_MESSAGE });
  }
});

export default router;