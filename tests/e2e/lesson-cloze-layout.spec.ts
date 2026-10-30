import { expect, test, type Page, type TestInfo } from "@playwright/test";
import type { TaskDto } from "@learning/contracts";
import { installKidUiFixture } from "./helpers/kid-ui-fixture";
import { assignmentAttempt, lessonTaskFixture, openLessonTask, recordAttemptPosts, tapPoolAndCheck } from "./helpers/lesson-assignment-task";
import { expectButtonsNotClipped, expectTargetsReachable } from "./helpers/lesson-reach";

/**
 * Geometria „Uzupełnij tekst” (`lesson_cloze`) w interfejsie dziecka (API
 * zaślepione w przeglądarce, design szkoły §13.5). Na wąskim telefonie
 * (320 px), w portrecie, niskim landscape (<480 px), na tablecie i desktopie:
 * tekst z czterema lukami zawija się w kontenerze materiału, miejsca luk, bank
 * słów i „Sprawdź” są osiągalne (w viewporcie po przewinięciu), bez poziomego
 * przepełnienia, z celami ≥48 px i główną akcją ≥54 px; bank stoi tuż pod
 * miejscami luk na każdym ekranie. Symulacja nie zastępuje odbioru na
 * fizycznym urządzeniu.
 */

const childId = "10000000-0000-4000-8000-000000000801";
const deckId = "10000000-0000-4000-8000-000000000802";
const sessionId = "10000000-0000-4000-8000-000000000803";
const versionId = "10000000-0000-4000-8000-000000000804";
const clozeTaskId = "10000000-0000-4000-8000-000000000811";
const uid = (n: number) => `10000000-0000-4000-8000-0000000008${String(n).padStart(2, "0")}`;

const ids = { childId, deckId, sessionId, versionId };
const deck = { title: "Fotosynteza", subjectTitle: "Przyroda" };

const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];

const clozeTask: TaskDto = {
  taskId: clozeTaskId, sessionId, ordinal: 0, exerciseType: "lesson_cloze", direction: null, state: "issued", remainingAssessed: 2,
  prompt: {
    kind: "lesson_cloze",
    instructionPl: "Uzupełnij tekst. Wybierz słowo do każdej luki.",
    segments: [
      { text: "Roślina pobiera z powietrza " },
      { gapId: uid(20) },
      { text: ", a korzeniami czerpie z gleby wodę i rozpuszczone w niej sole mineralne. W zielonych liściach, dzięki energii " },
      { gapId: uid(21) },
      { text: ", powstają " },
      { gapId: uid(22) },
      { text: ". Do powietrza roślina oddaje przy tym " },
      { gapId: uid(23) },
      { text: ", którym oddychają zwierzęta i ludzie." },
    ],
    words: [
      { id: uid(30), text: "światła słonecznego" },
      { id: uid(31), text: "tlen" },
      { id: uid(32), text: "dwutlenek węgla" },
      { id: uid(33), text: "azot" },
      { id: uid(34), text: "cukry" },
      { id: uid(35), text: "chlorofil" },
    ],
  },
};

/**
 * Tekst z lukami rozdziału angielskiego: `contentLocale` „en-GB” — każdy
 * fragment tekstu stoi w osobnym `<span lang>`, a słowa banku i wypełnione
 * luki też niosą `lang`. Polecenie niesie polskie znaczenie całego tekstu
 * (jak w zeszycie ćwiczeń), więc jest dłuższe niż w szkole.
 */
const chapterDeck = { title: "Angielski — rozdział: Unit 1", subjectTitle: "Angielski — rozdział" };
const chapterClozeTask: TaskDto = {
  taskId: uid(12), sessionId, ordinal: 0, exerciseType: "lesson_cloze", direction: null, state: "issued", remainingAssessed: 2,
  prompt: {
    kind: "lesson_cloze",
    instructionPl: "W poniedziałek pada deszcz i mam na sobie kalosze. We wtorek wieje wiatr. W piątek jest słonecznie, więc mam na sobie koszulkę i szorty. Uzupełnij tekst.",
    contentLocale: "en-GB",
    segments: [
      { text: "On Monday it's " },
      { gapId: uid(40) },
      { text: " and I'm wearing my " },
      { gapId: uid(41) },
      { text: ". On Tuesday it's " },
      { gapId: uid(42) },
      { text: ". On Friday it's sunny, so I'm wearing a " },
      { gapId: uid(43) },
      { text: " and shorts." },
    ],
    words: [
      { id: uid(50), text: "wellington boots" },
      { id: uid(51), text: "raining" },
      { id: uid(52), text: "windy" },
      { id: uid(53), text: "T-shirt" },
      { id: uid(54), text: "snowing" },
      { id: uid(55), text: "scarf" },
    ],
  },
};

/** Geometria tekstu z lukami na każdym ekranie (po wypełnieniu dwóch luk przez wywołującego). */
async function expectClozeGeometry(page: Page, testInfo: TestInfo, shotPrefix: string): Promise<void> {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    const label = `${viewport.width}x${viewport.height}`;
    await expectTargetsReachable(page, viewport, [
      { testId: "kid-lesson-cloze-text", tall: true },
      ...Array.from({ length: 4 }, (_, nth) => ({ testId: "kid-lesson-cloze-slot", nth, minHeight: 48 })),
      ...Array.from({ length: 4 }, (_, nth) => ({ testId: "kid-lesson-cloze-option", nth, minHeight: 48 })),
      { testId: "kid-lesson-check", minHeight: 54 },
    ]);
    await expectButtonsNotClipped(page, "kid-lesson-cloze-slot", label);
    await expectButtonsNotClipped(page, "kid-lesson-cloze-option", label);
    // Luka w tekście nie wystaje poza akapit (zawija się razem z tekstem).
    const text = (await page.getByTestId("kid-lesson-cloze-text").boundingBox())!;
    for (const gap of await page.getByTestId("kid-lesson-cloze-gap").all()) {
      const bounds = (await gap.boundingBox())!;
      expect(bounds.x, `gap inside text at ${label}`).toBeGreaterThanOrEqual(text.x - 1);
      expect(bounds.x + bounds.width, `gap inside text at ${label}`).toBeLessThanOrEqual(text.x + text.width + 1);
    }
    // Jedna kolumna: tekst, pod nim miejsca luk, tuż pod nimi bank (także w niskim landscape).
    const lastSlot = (await page.getByTestId("kid-lesson-cloze-slot").last().boundingBox())!;
    const pool = (await page.getByTestId("kid-lesson-cloze-pool").boundingBox())!;
    const firstSlot = (await page.getByTestId("kid-lesson-cloze-slot").first().boundingBox())!;
    expect(firstSlot.y, `slots below text at ${label}`).toBeGreaterThanOrEqual(text.y + text.height - 1);
    expect(pool.y, `bank below slots at ${label}`).toBeGreaterThanOrEqual(lastSlot.y + lastSlot.height - 1);
    expect(pool.y - (lastSlot.y + lastSlot.height), `bank right under slots at ${label}`).toBeLessThan(80);
    await page.screenshot({ path: testInfo.outputPath(`${shotPrefix}-${label}.png`) });
  }
}

test("cloze: text with four gaps, slots, word bank and check fit every form factor", async ({ page }, testInfo) => {
  await installKidUiFixture(page, lessonTaskFixture(ids, deck, [clozeTask]));
  await openLessonTask(page, VIEWPORTS[1]!, "kid-lesson-cloze");
  await expect(page.getByTestId("kid-instruction")).toContainText("Uzupełnij tekst.");
  await expect(page.getByTestId("kid-lesson-cloze-gap")).toHaveCount(4);
  await expect(page.getByTestId("kid-lesson-cloze-text").locator("button")).toHaveCount(0);
  await expect(page.getByTestId("kid-lesson-cloze-slot")).toHaveCount(4);
  // Bez contentLocale tekst nie jest dzielony na fragmenty z `lang`.
  await expect(page.getByTestId("kid-lesson-cloze-segment")).toHaveCount(0);
  // Dwie luki wypełnione przed pomiarem: najdłuższe słowo stoi w tekście i w miejscu, reszta w banku.
  await page.getByTestId("kid-lesson-cloze-option").filter({ hasText: "dwutlenek węgla" }).click();
  await page.getByTestId("kid-lesson-cloze-option").filter({ hasText: "światła słonecznego" }).click();
  await expect(page.getByTestId("kid-lesson-cloze-option")).toHaveCount(4);
  await expect(page.getByTestId("kid-lesson-cloze-text")).toContainText("światła słonecznego");
  await expectClozeGeometry(page, testInfo, "cloze");
});

test("cloze (English chapter, contentLocale en-GB): lang-wrapped text, slots and bank fit every form factor", async ({ page }, testInfo) => {
  await installKidUiFixture(page, lessonTaskFixture(ids, chapterDeck, [chapterClozeTask]));
  await openLessonTask(page, VIEWPORTS[1]!, "kid-lesson-cloze");
  await expect(page.getByTestId("kid-instruction")).toContainText("Uzupełnij tekst.");
  await expect(page.getByTestId("kid-lesson-cloze-gap")).toHaveCount(4);
  await expect(page.getByTestId("kid-lesson-cloze-slot")).toHaveCount(4);
  // Ścieżka z językiem treści: każdy fragment tekstu w osobnym `<span lang="en-GB">`, bank też z `lang`.
  const segments = page.getByTestId("kid-lesson-cloze-segment");
  await expect(segments).toHaveCount(5);
  for (const segment of await segments.all()) await expect(segment).toHaveAttribute("lang", "en-GB");
  for (const option of await page.getByTestId("kid-lesson-cloze-option").all()) await expect(option).toHaveAttribute("lang", "en-GB");
  // Dwie luki wypełnione przed pomiarem (najdłuższe słowo banku w tekście i w miejscu luki).
  await page.getByTestId("kid-lesson-cloze-option").filter({ hasText: "raining" }).click();
  await page.getByTestId("kid-lesson-cloze-option").filter({ hasText: "wellington boots" }).click();
  await expect(page.getByTestId("kid-lesson-cloze-option")).toHaveCount(4);
  await expect(page.getByTestId("kid-lesson-cloze-text")).toContainText("wellington boots");
  await expect(page.getByTestId("kid-lesson-cloze-slot").first()).toHaveAttribute("lang", "en-GB");
  await expectClozeGeometry(page, testInfo, "chapter-cloze");
});

test("cloze: check sends gap → word assignments and shows the completed text after a mistake", async ({ page }) => {
  const posted = recordAttemptPosts(page);
  // Pełny tekst zadania z poprawnymi słowami we wszystkich czterech lukach (jak `filledText` serwera).
  const solution = ["dwutlenek węgla", "światła słonecznego", "cukry", "tlen"];
  if (clozeTask.prompt.kind !== "lesson_cloze") throw new Error("cloze fixture expected");
  let gap = 0;
  const correctText = clozeTask.prompt.segments.map((segment) => ("gapId" in segment ? solution[gap++] : segment.text)).join("");
  expect(gap).toBe(4);
  const kidFixture = lessonTaskFixture(ids, deck, [clozeTask], [assignmentAttempt(uid(90), clozeTaskId, { kind: "incorrect", correctText })]);
  await installKidUiFixture(page, kidFixture);
  await openLessonTask(page, VIEWPORTS[1]!, "kid-lesson-cloze");
  const assignments = await tapPoolAndCheck(page, "kid-lesson-cloze-option", 4, posted);
  expect(assignments.map((entry) => entry.itemId)).toEqual([uid(20), uid(21), uid(22), uid(23)]);
  await expect(page.getByText(correctText)).toBeVisible();
  await expect(page.getByTestId("kid-lesson-cloze-option").first()).toBeDisabled();
});
