# CrewPulse + Supabase

## الملفات
- `index.html` — الموقع (نفس تصميمك، مع مزامنة سحابية اختيارية)
- `config.js` — ضع فيه Project URL و anon key
- `cloud.js` — طبقة المزامنة (تعمل أوفلاين وترفع لما يرجع النت)
- `supabase/schema.sql` — الجداول + الصلاحيات (RLS)

## خطوات التشغيل
1. أنشئ مشروعًا على https://supabase.com
2. **SQL Editor → New query** → الصق محتوى `supabase/schema.sql` كله → **Run**
3. **Project Settings → API** → انسخ `Project URL` و `anon public key` → ضعهم في `config.js`
4. (اختياري) **Authentication → Providers → Email**: اقفل "Confirm email" لو عاوز تدخل مباشرة بدون تأكيد
5. ارفع الموقع (Netlify / Vercel / Cloudflare Pages / GitHub Pages) أو افتح `index.html` من سيرفر محلي
6. من الموقع: **☁️ تسجيل الدخول → إنشاء حساب** — أول حساب بيعمل مشروعه تلقائيًا ويكون "مالك"
7. لإضافة زميل: يسجّل حساب أولًا، وبعدها المالك يضيفه من نفس النافذة بالإيميل

## الجداول
| الجدول | الغرض |
|---|---|
| `projects` / `project_members` | المشاريع وأعضاؤها (owner / member) |
| `workfronts` | القائمة الرئيسية (الكميات المخططة) |
| `shift_logs` | تسجيل الورديات |
| `constraint_log` | المعوقات (مفتوحة/مغلقة) |
| `constraint_catalog` | أنواع المعوقات (9 أنواع) |

## ملاحظات أمان
- مفتاح `anon` عادي ينزل مع الموقع؛ الحماية الفعلية من RLS: كل عضو يشوف مشروعه فقط، والزائر بدون تسجيل ما يوصلش لأي بيانات.
- لا تضع مفتاح `service_role` في أي ملف من الموقع.
- مسح كل البيانات من الموقع متاح لمالك المشروع فقط (فحص من الواجهة).
- شغّل الموقع بدون إعداد `config.js` وهيشتغل محليًا زي النسخة الأصلية.
