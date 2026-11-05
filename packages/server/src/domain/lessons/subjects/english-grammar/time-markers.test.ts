import { describe, expect, it } from "vitest";
import { scanTimeMarkers, TIME_MARKER_LISTS } from "./time-markers";

const groups = (text: string, lang: "en" | "pl") => [...scanTimeMarkers(text, lang).groups].sort();

describe("scanTimeMarkers — grupy", () => {
  it("angielskie grupy", () => {
    expect(groups("She is reading now.", "en")).toEqual(["now"]);
    expect(groups("Look! Dad is cooking.", "en")).toEqual(["now"]);
    expect(groups("Listen, the baby is crying.", "en")).toEqual(["now"]);
    expect(groups("They listen to music every day.", "en")).toEqual(["usually"]);
    expect(groups("I look at the board.", "en")).toEqual([]);
    expect(groups("We play football every summer.", "en")).toEqual(["usually"]);
    expect(groups("She swims three times a week.", "en")).toEqual(["usually"]);
    expect(groups("He plays tennis on Saturdays.", "en")).toEqual(["usually"]);
    expect(groups("Shh! Grandpa is sleeping.", "en")).toEqual(["now"]);
  });

  it("dalsze angielskie frazy", () => {
    expect(groups("They are at home right now.", "en")).toEqual(["now"]);
    expect(groups("She is at the moment busy.", "en")).toEqual(["now"]);
    expect(groups("Be quiet! The baby is sleeping.", "en")).toEqual(["now"]);
    expect(groups("She often plays chess.", "en")).toEqual(["usually"]);
    expect(groups("He swims twice a week.", "en")).toEqual(["usually"]);
    expect(groups("He swims 3 times a day.", "en")).toEqual(["usually"]);
    expect(groups("We play at weekends.", "en")).toEqual(["usually"]);
    expect(groups("I read every Monday.", "en")).toEqual(["usually"]);
    expect(groups("I never eat fish.", "en")).toEqual(["usually"]);
  });

  it("wykrzyknienie tylko na początku zdania", () => {
    expect(groups("They say: Look! A bird.", "en")).toEqual([]);
    expect(groups("Look at me.", "en")).toEqual([]);
    expect(groups("Listen to me!", "en")).toEqual([]);
    expect(groups("Dad is here. Look! Mum is cooking.", "en")).toEqual(["now"]);
    expect(groups('He said "Wow!" Shh, the baby sleeps.', "en")).toEqual(["now"]);
    expect(groups("  „Cicho! Dziadek śpi.”", "pl")).toEqual(["now"]);
    expect(groups("Tata czyta. Patrz! Mama gotuje.", "pl")).toEqual(["now"]);
  });

  it("słowa podobne do wskaźników nie są wskaźnikami", () => {
    expect(groups("Co robisz?", "pl")).toEqual([]);
    expect(groups("Każdy lubi lody.", "pl")).toEqual([]);
    expect(groups("I know the snow.", "en")).toEqual([]);
  });

  it("polskie scenki", () => {
    expect(groups("Cicho! Dziadek śpi.", "pl")).toEqual(["now"]);
    expect(groups("Ola cicho czyta wieczorami.", "pl")).toEqual([]);
    expect(groups("Gdzie jest tata?", "pl")).toEqual(["now"]);
    expect(groups("Ola zazwyczaj czyta po obiedzie.", "pl")).toEqual(["usually"]);
    expect(groups("Każdego dnia Tom jeździ na rowerze.", "pl")).toEqual(["usually"]);
    expect(groups("Teraz czy zwykle?", "pl")).toEqual(["now", "usually"]);
  });

  it("dalsze polskie frazy i wykrzyknienia z diakrytykami", () => {
    expect(groups("Spójrz! Mama gotuje.", "pl")).toEqual(["now"]);
    expect(groups("Posłuchaj, dziecko płacze.", "pl")).toEqual(["now"]);
    expect(groups("Słuchaj! Ktoś śpiewa.", "pl")).toEqual(["now"]);
    expect(groups("Ciii! Dziadek śpi.", "pl")).toEqual(["now"]);
    expect(groups("Tata w tej chwili czyta.", "pl")).toEqual(["now"]);
    expect(groups("Ola właśnie rysuje.", "pl")).toEqual(["now"]);
    expect(groups("Gdzie są dzieci?", "pl")).toEqual(["now"]);
    expect(groups("Dzieci biegają, gdzie jest piłka?", "pl")).toEqual([]);
    expect(groups("Co rano Ola pije mleko.", "pl")).toEqual(["usually"]);
    expect(groups("Mama gotuje co wieczór.", "pl")).toEqual(["usually"]);
    expect(groups("Każdego wieczoru czytamy.", "pl")).toEqual(["usually"]);
    expect(groups("W każdy piątek gramy.", "pl")).toEqual(["usually"]);
    expect(groups("We wtorki pływamy.", "pl")).toEqual(["usually"]);
    expect(groups("W weekendy gramy w piłkę.", "pl")).toEqual(["usually"]);
    expect(groups("Tom często maluje.", "pl")).toEqual(["usually"]);
  });
});

describe("scanTimeMarkers — wskaźniki zakazane", () => {
  it("angielskie i polskie", () => {
    expect(scanTimeMarkers("I'm playing tennis tomorrow.", "en").forbidden).toEqual(["tomorrow"]);
    expect(scanTimeMarkers("He is swimming this afternoon.", "en").forbidden).toEqual(["this afternoon"]);
    expect(scanTimeMarkers("She plays on Saturday.", "en").forbidden).toEqual(["on saturday"]);
    expect(scanTimeMarkers("She plays on Saturdays.", "en").forbidden).toEqual([]);
    expect(scanTimeMarkers("Jutro gramy.", "pl").forbidden).toEqual(["jutro"]);
  });

  it("pozostałe zakazane frazy", () => {
    expect(scanTimeMarkers("We go to a party tonight.", "en").forbidden).toEqual(["tonight"]);
    expect(scanTimeMarkers("We go next week.", "en").forbidden).toEqual(["next week"]);
    expect(scanTimeMarkers("We go next Monday.", "en").forbidden).toEqual(["next monday"]);
    expect(scanTimeMarkers("She is sitting next to Tom.", "en").forbidden).toEqual([]);
    expect(scanTimeMarkers("Ola czyta dziś.", "pl").forbidden).toEqual(["dziś"]);
    expect(scanTimeMarkers("He is reading today.", "en").forbidden).toEqual(["today"]);
    expect(scanTimeMarkers("We swim this morning.", "en").forbidden).toEqual(["this morning"]);
    expect(scanTimeMarkers("We swim this evening.", "en").forbidden).toEqual(["this evening"]);
    expect(scanTimeMarkers("We swim at the weekend.", "en").forbidden).toEqual(["at the weekend"]);
    expect(scanTimeMarkers("Ola czyta wieczorem.", "pl").forbidden).toEqual(["wieczorem"]);
    expect(scanTimeMarkers("Ola czyta dzisiaj.", "pl").forbidden).toEqual(["dzisiaj"]);
  });

  it("wskaźniki zwykle i wieczór nie są zakazane", () => {
    expect(scanTimeMarkers("We swim every weekend.", "en").forbidden).toEqual([]);
    expect(scanTimeMarkers("Co wieczór czytamy.", "pl").forbidden).toEqual([]);
    expect(scanTimeMarkers("Każdego wieczoru czytamy.", "pl").forbidden).toEqual([]);
  });
});

describe("TIME_MARKER_LISTS", () => {
  it("udostępnia listy do promptu", () => {
    expect(TIME_MARKER_LISTS.nowEn).toContain("right now");
    expect(TIME_MARKER_LISTS.usuallyEn).toContain("every day");
    expect(TIME_MARKER_LISTS.nowPl).toContain("w tej chwili");
    expect(TIME_MARKER_LISTS.usuallyPl).toContain("każdego dnia");
    expect(TIME_MARKER_LISTS.forbidden).toContain("tomorrow");
  });
});
