# Drive2Tube Studio — أداة الربط المباشر بين Google Drive و YouTube

تطبيق ويب عربي كامل (RTL) يتيح لك ربط حساب **Google** وقناتك على **YouTube** مباشرة، تصفح مجلدات **Google Drive**، تعديل تفاصيل كل فيديو (العنوان، الوصف، الوسوم، الخصوصية، جدولة النشر)، ورفع الفيديوهات تلقائياً إلى قناتك على YouTube بتقنية الرفع المجزأ القابل للاستئناف (يدعم الفيديوهات الكبيرة > 50MB).

## المميزات

- **ربط مباشر بـ Google OAuth 2.0**:
  - يدعم **الربط السريع** عبر نافذة Google (بـ `Client ID` فقط).
  - ويدعم **الربط الدائم بالتجديد التلقائي** (`Client ID + Client Secret`) مع تخزين مشفر (`AES-256-GCM`) في `HttpOnly Cookie`.
- **متصفح مجلدات Google Drive**:
  - مربوط مسبقاً بمجلدات `YouTube_Queue` و `YouTube_Published` مع إمكانية تصفح `My Drive` أو أي مجلد مخصص.
- **رفع مجزأ قابل للاستئناف (Chunked Resumable Upload)**:
  - ينقل الفيديو على مقاطع 4–12 MB مباشرة من Google Drive إلى YouTube عبر السيرفر بدون تحميله على جهازك.
- **المحرك التلقائي للنشر**:
  - فحص دوري (كل 5 / 15 / 30 / 60 دقيقة) مع مؤقت تنازلي، نقل تلقائي إلى `YouTube_Published`، رفع الصورة المصغرة المطابقة تلقائياً، وتسجيل رابط النشر في Google Sheets.

## التشغيل المحلي

```bash
cd tools/drive-to-youtube-web
npm start
```

## تشغيل الاختبارات

```bash
node --test tools/drive-to-youtube-web/tests/app.test.js
```
