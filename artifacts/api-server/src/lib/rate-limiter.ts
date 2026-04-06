import rateLimit from "express-rate-limit";

// Global rate limit: 300 req/min per IP
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "تجاوزت الحد المسموح به من الطلبات. حاول مرة أخرى لاحقاً." },
});

// Strict rate limit for auth endpoints: 20 req / 15 min
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "تم تجاوز عدد محاولات تسجيل الدخول المسموح بها. حاول بعد 15 دقيقة." },
});
