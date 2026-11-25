const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const TEXT_PATH = path.join(__dirname, "..", "shared", "text.js");

function freshText(withoutSegmenter) {
  delete require.cache[require.resolve(TEXT_PATH)];
  const orig = Intl.Segmenter;
  if (withoutSegmenter) Intl.Segmenter = undefined;
  try { return require(TEXT_PATH); } finally { Intl.Segmenter = orig; delete require.cache[require.resolve(TEXT_PATH)]; }
}
// The module resolves Intl.Segmenter lazily, so the fallback run must keep it
// hidden while splitting, not just while loading.
function split(text, withoutSegmenter) {
  const T = freshText(withoutSegmenter);
  const orig = Intl.Segmenter;
  if (withoutSegmenter) Intl.Segmenter = undefined;
  try { return T.splitIntoSentences(text); } finally { Intl.Segmenter = orig; }
}

const CASES = [
  ["French: abbreviations, decimal, guillemets",
    "M. Dupont est arrivé à 3.5 heures. Il a dit « Bonjour. » Puis il est parti ! Vraiment ? Mme Martin, cf. le chapitre 2, a répondu : oui.",
    ["M. Dupont est arrivé à 3.5 heures.", "Il a dit « Bonjour. »", "Puis il est parti !", "Vraiment ?", "Mme Martin, cf. le chapitre 2, a répondu : oui."]],
  ["Arabic: full stop, question mark, exclamation",
    "ذهب أحمد إلى السوق. هل رأيته؟ نعم! ثم عاد إلى البيت.",
    ["ذهب أحمد إلى السوق.", "هل رأيته؟", "نعم!", "ثم عاد إلى البيت."]],
  ["Mixed English, French and Arabic in one paragraph",
    "Dr. Lee said hello. Elle a répondu : « Très bien. » Then مرحبا بكم. هل أنت بخير؟ Fine.",
    ["Dr. Lee said hello.", "Elle a répondu : « Très bien. »", "Then مرحبا بكم.", "هل أنت بخير؟", "Fine."]],
  ["English abbreviations and a French paragraph after a break",
    "Analysts, e.g. Mr. Brown, agree. Growth was 3.2% in Q3.\n\nNouveau paragraphe sans point",
    ["Analysts, e.g. Mr. Brown, agree.", "Growth was 3.2% in Q3.", "Nouveau paragraphe sans point"]],
  ["French month abbreviation and n°",
    "Il est arrivé le 5 janv. 2020 à Paris. Il pleuvait. Voici l’exemple n° 4. Suite du texte ici.",
    ["Il est arrivé le 5 janv. 2020 à Paris.", "Il pleuvait.", "Voici l’exemple n° 4.", "Suite du texte ici."]]
];

for (const [name, input, expected] of CASES) {
  test("Segmenter path: " + name, () => {
    assert.equal(typeof Intl.Segmenter, "function", "this Node build has Intl.Segmenter");
    assert.deepEqual(split(input, false), expected);
  });
  test("Regex fallback (no Intl.Segmenter): " + name, () => {
    assert.deepEqual(split(input, true), expected);
  });
}

test("language choice: Arabic, French and English paragraphs", () => {
  const T = freshText(false);
  assert.ok(T.splitIntoSentences("هذا نص عربي. وهذه جملة ثانية؟").length === 2);
  assert.ok(T.splitIntoSentences("Ceci est une phrase. Voici la suivante !").length === 2);
  assert.ok(T.splitIntoSentences("This is one. This is two!").length === 2);
});

const CORPUS = [
  ['fr news 1', "Le président de la République a déclaré, lundi à 14 h 30, que le budget 2025 serait réduit de 3,5 %. « Nous devons agir maintenant », a-t-il ajouté. Les syndicats, eux, restent sceptiques.", 3],
  ['fr abbr', "Selon M. Durand et Mme Leroy, la réunion aura lieu le 12 févr. à Paris, av. des Champs-Élysées. Dr. Martin y sera aussi. Voir p. 45 et fig. 3 pour plus de détails.", 3],
  ['fr M. start', "M. Dupont, directeur de la société S.A.R.L. Alpha, a signé le contrat. Il est content.", 2],
  ['ar news', "أعلنت وزارة التربية الوطنية يوم الاثنين عن نتائج الامتحانات. وقد بلغت نسبة النجاح 78.5 في المائة. هل ستتحسن النتائج العام المقبل؟ يقول الخبراء إنها ستتحسن.", 4],
  ['ar with latin', "استخدم الباحث برنامج Python في التحليل. ثم نشر النتائج في مجلة Nature. كانت النتائج مذهلة!", 3],
  ['ar comma ،', "ذهب إلى المدرسة، ثم عاد إلى البيت، وبعد ذلك نام. استيقظ في الصباح.", 2],
  ['ar quotes', "قال المعلم: «افتحوا الكتب.» ثم بدأ الدرس. انتهى الدرس مبكرا.", 3],
  ['en abbr', "Prof. Smith, Ph.D., arrived at 5 p.m. on Jan. 5 with Mr. and Mrs. Jones. They discussed Fig. 2 and Vol. 3, pp. 10-12. Then they left.", 3],
  ['en U.S.', "The U.S. economy grew 3.2% last quarter. Analysts at J.P. Morgan disagreed. Why?", 3],
  ['mixed fr para with en quote', "Le titre du film est \"The Lost City.\" Il est sorti en 2022. Les critiques l'ont aimé.", 3],
  ['mixed en with arabic word', "The word مرحبا means hello. It is common in Arabic. Many people say it daily.", 3],
  ['mixed ar with french', "قال الفرنسي: Bonjour, comment allez-vous. فأجابه الجزائري بالعربية. ثم ضحكا.", 3],
  ['mixed fr with arabic name', "Le professeur محمد est arrivé à l'heure. Il a salué les élèves. La classe a commencé.", 3],
  ['short fr', "Oui. Non. Peut-être !", 3],
  ['en ellipsis', "Well… maybe. I don't know. Perhaps tomorrow?", 3],
  ['fr number list', "Le 1er janv. 2020, il y avait 3.000 personnes. Ensuite, 2 500 autres sont arrivées.", 2],
  ['ar numbers arabic-indic', "بلغ عدد السكان ٣٫٥ مليون نسمة. وهذا رقم كبير. هل تعلم ذلك؟", 3],
  ["Arabic title د. before a name", "قال د. أحمد إن الأمر بسيط. ثم غادر المكان.", 2],
  ["Arabic title أ.د. before a name", "استقبل أ.د. محمد الوفد. ثم غادر.", 2]
];
for (const [name, input, count] of CORPUS) {
  test("corpus (Segmenter): " + name, () => assert.equal(split(input, false).length, count, JSON.stringify(split(input, false))));
  test("corpus (fallback): " + name, () => assert.equal(split(input, true).length, count, JSON.stringify(split(input, true))));
}
