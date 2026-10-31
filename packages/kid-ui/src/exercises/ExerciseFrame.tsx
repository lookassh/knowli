import { useEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { AnimatePresence } from "motion/react";
import type { TaskDto } from "@learning/contracts";
import { ExerciseInstruction, type ExerciseInstructionAudio } from "../components/ExerciseInstruction";
import { cssZoomOf, toLayoutPx } from "../layout/css-zoom";
import { useIsomorphicLayoutEffect } from "../layout/isomorphic-layout-effect";
import classes from "./ExerciseFrame.module.css";
import { useExerciseGuidance } from "./exercise-guidance";
import { getExercisePresentation } from "./exercise-presentation";
import {
  scheduleFeedbackDockReveal,
  shouldRevealFeedbackDock,
  type FeedbackDockRevealState,
} from "./feedback-dock-reveal";

/**
 * Rama zadania: siatka instrukcja / materiał / akcje (w zwartym układzie
 * kolumna flex z odstępem od góry, ExerciseFrame.module.css). Zwykle przewija się
 * tylko materiał; przy długiej odpowiedzi wyboru rama też może się przewinąć,
 * aby zachować pełny tekst i czytelne minimum materiału. AppShell nie przeszedł
 * weryfikacji runtime (jego hooki wymagają `useEffectEvent`,
 * niedostępnego w przypiętym React), dlatego szkielet opiera się na
 * zwyklych elementach i module CSS. Wynik próby trafia do stopki jako `dock` — bodziec
 * i odpowiedzi pozostają zamontowane. W trybie flow stopka ma rzeczywistą
 * wysokość; materiał może się zmniejszyć lub przewijać po werdykcie.
 */
export function ExerciseFrame({
  task,
  content,
  actions,
  secondaryActions,
  actionLayout = "stacked",
  dock,
  feedbackLayout = "overlay",
  instructionAudio,
}: {
  task: TaskDto;
  content: ReactNode;
  actions?: ReactNode;
  secondaryActions?: ReactNode;
  actionLayout?: "stacked" | "inline";
  dock?: ReactNode;
  /** Choice tasks use a real footer instead of reserving space for an overlay. */
  feedbackLayout?: "overlay" | "flow";
  instructionAudio?: ExerciseInstructionAudio;
}): ReactElement {
  const presentation = getExercisePresentation(task);
  const guidance = useExerciseGuidance();
  const materialRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const gatedDockRef = useRef<{ overlay: HTMLElement; enabled: boolean } | null>(null);
  const scrolledKeyRef = useRef<{ overlay: HTMLElement; key: string } | null>(null);
  const measureRef = useRef<((mode: "layout" | "observer") => void) | null>(null);
  // Ostatnia rezerwa zlecona przez pomiar: pomiar z obserwatora porównuje z nią
  // nową wartość, bo stan z domknięcia efektu byłby nieaktualny.
  const requestedPadRef = useRef(0);
  const revealStateRef = useRef<FeedbackDockRevealState>({ overlay: null, required: false });
  const revealCleanupRef = useRef<(() => void) | null>(null);
  const revealTaskIdRef = useRef<string | null>(null);
  const [dockPad, setDockPad] = useState(0);
  const hasDock = dock !== undefined;
  // A task without a primary action gets no empty 54px slot (before or under the dock).
  const hasActions = actions !== undefined && actions !== null && actions !== false;
  const flowFeedback = feedbackLayout === "flow";

  // Revealing is tied to a dock/task and viewport mode, never to the newly
  // allocated JSX node passed by LearnScreen on unrelated renders. Observe
  // KidPage and frame geometry so rotation/zoom and growing feedback work
  // without a child render. Manual scrolling never triggers another reveal.
  useEffect(() => {
    if (revealTaskIdRef.current !== task.taskId) {
      revealTaskIdRef.current = task.taskId;
      revealStateRef.current = { overlay: null, required: false };
    }
    if (!hasDock) {
      revealStateRef.current = { overlay: null, required: false };
      return;
    }
    const overlay = overlayRef.current;
    const page = overlay?.closest<HTMLElement>(".kid-page");
    const frameRoot = overlay?.closest<HTMLElement>(".kid-exercise-frame");
    if (!overlay || !page) return;
    let active = true;

    const revealIfNeeded = () => {
      if (!active) return;
      const frameOverflows = flowFeedback && frameRoot !== null && frameRoot !== undefined
        && frameRoot.scrollHeight > frameRoot.clientHeight + 1;
      const required = page.dataset.zoomed === "true" || page.dataset.viewportVeryShort === "true" || frameOverflows;
      const shouldReveal = shouldRevealFeedbackDock(revealStateRef.current, overlay, required);
      if (!required) {
        revealCleanupRef.current?.();
        revealCleanupRef.current = null;
        return;
      }
      if (!shouldReveal) return;
      revealCleanupRef.current?.();
      revealCleanupRef.current = scheduleFeedbackDockReveal(overlay);
    };

    revealIfNeeded();
    const observer = new MutationObserver(revealIfNeeded);
    observer.observe(page, { attributes: true, attributeFilter: ["data-zoomed", "data-viewport-very-short"] });
    const resizeObserver = flowFeedback && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(revealIfNeeded) : null;
    if (resizeObserver && frameRoot) {
      resizeObserver.observe(frameRoot);
      resizeObserver.observe(overlay);
    }
    return () => {
      active = false;
      observer.disconnect();
      resizeObserver?.disconnect();
      revealCleanupRef.current?.();
      revealCleanupRef.current = null;
      // Also allows React Strict Mode's setup/cleanup replay to schedule
      // the frame again after the first setup was cancelled.
      revealStateRef.current.required = false;
    };
  }, [hasDock, task.taskId, flowFeedback]);

  // Dock zwykły i mowy rezerwuje w materiale dokładnie tyle, o ile
  // panel wystaje ponad stopkę w trybie overlay — ale tylko gdy treść naprawdę
  // wchodzi pod panel; inaczej nie powstaje zbędny ogon scrolla. Rezerwa
  // jest wyliczana od zera przy każdej zmianie rozmiaru (materiał, panel,
  // okno/klawiatura), więc nie rośnie monotonicznie. Przewinięcie
  // korygujące następuje od zakładki 1 px ekranu — po korekcie znika, więc
  // pomiary nie dokładają scrolla w pętli, a po otwarciu klawiatury
  // ekranowej albo rotacji liczy się jeszcze raz.
  //
  // Rezerwa jest gotowa przed malowaniem (spec 2026-10-31 §3.2): efekt layoutu
  // mierzy w commicie, w którym pojawia się panel, a `setDockPad` z efektu
  // layoutu React renderuje synchronicznie, zanim przeglądarka cokolwiek
  // namaluje. Akcje zadania znikają w tym samym commicie (są poza
  // AnimatePresence), więc pierwszy pomiar widzi ułożoną stopkę. Efekt zależy
  // od obecności panelu, zadania i trybu — nie od węzła `dock`, który
  // LearnScreen tworzy przy każdym renderze.
  useIsomorphicLayoutEffect(() => {
    if (!hasDock || flowFeedback) {
      gatedDockRef.current = null;
      scrolledKeyRef.current = null;
      requestedPadRef.current = 0;
      setDockPad(0);
      return;
    }
    const material = materialRef.current;
    const anchor = anchorRef.current;
    const overlay = overlayRef.current;
    if (!material || !anchor || !overlay) return;
    // Nowa rezerwa zawsze kończy pomiar: korektę przewinięcia robi efekt
    // `[dockPad]` na świeżym układzie, jeszcze przed malowaniem. Liczona tutaj
    // byłaby na układzie sprzed rezerwy — przy materiale, który już się
    // przewija, zatrzymałaby się na starym końcu zakresu i zostawiła pod
    // panelem kilka px, poniżej progu kolejnej korekty. `layout` — wywołanie
    // z efektu layoutu (tutaj albo po zmianie `dockPad`): zwykły `setDockPad`,
    // który React renderuje synchronicznie. `observer` — callback
    // `ResizeObserver` albo `requestAnimationFrame`, czyli poza Reactem, ale
    // też przed malowaniem: rezerwa wchodzi przez `flushSync`. `flushSync`
    // nigdy nie jest wołany w efekcie layoutu — React by ostrzegał.
    const measure = (mode: "layout" | "observer") => {
      const excess = Math.max(0, Math.ceil(overlay.offsetHeight - anchor.offsetHeight));
      const content = material.querySelector<HTMLElement>(".kid-material-content");
      // Prostokąty są w px ekranu, a offsetHeight i scrollTop w px wewnętrznych
      // (zoom dużego okna) — krawędzie z prostokątów przeliczamy przed porównaniem.
      const contentBottom = content && content.children.length > 0
        ? toLayoutPx(Math.max(...[...content.children].map((child) => child.getBoundingClientRect().bottom)), material)
        : null;
      // Górna krawędź panelu z prostokąta nakładki — ułamkowa, bez zaokrąglenia
      // offsetHeight. Nakładka nie ma transformacji: animacja wejścia działa na
      // panelu w jej wnętrzu.
      const dockTop = toLayoutPx(overlay.getBoundingClientRect().top, material);
      const overlap = contentBottom === null ? 0 : contentBottom - dockTop;
      // Próg 1 px ekranu (spec 2026-10-31-kid-ui-dock-followups §3.3): od niego
      // włącza się bramka rezerwy i działa korekta przewinięcia. Mniejsza
      // zakładka to zaokrąglenia — nie dokłada zakresu przewijania ani nie przewija.
      const covers = overlap * cssZoomOf(material) >= 1;
      // Bramka rezerwy zatrzaskuje się na cały panel: późniejsze pomiary
      // (rAF, ResizeObserver) nie włączają jej wbrew pierwszemu pomiarowi,
      // a włącza ją dopiero realna zakładka po zmianie rozmiaru.
      if (gatedDockRef.current?.overlay !== overlay) {
        gatedDockRef.current = { overlay, enabled: covers };
      } else if (covers) {
        gatedDockRef.current.enabled = true;
      }
      const targetPad = gatedDockRef.current.enabled ? excess : 0;
      if (targetPad !== requestedPadRef.current) {
        requestedPadRef.current = targetPad;
        // Synchroniczna zmiana rozmiaru w callbacku obserwatora może dać
        // nieszkodliwe zdarzenie „ResizeObserver loop completed with
        // undelivered notifications”: powiadomienia o elementach, które
        // zmieniły rozmiar przez nową rezerwę, przechodzą do następnej klatki.
        if (mode === "observer") flushSync(() => setDockPad(targetPad));
        else setDockPad(targetPad);
        return;
      }
      // Po korekcie zakładka znika (treść kończy się 8 px nad panelem), więc
      // kolejne pomiary nie dokładają scrolla; następna korekta następuje
      // dopiero, gdy zakładka znów osiągnie próg (klawiatura, rotacja,
      // wzrost treści albo panelu). Klucz korekty pomija ręczne
      // przewinięcie dziecka: sam re-render z tym samym panelem,
      // rozmiarem materiału i treścią nie przewija ponownie.
      if (covers) {
        const scrollKey = `${material.clientWidth}x${material.clientHeight}:${material.scrollHeight}`;
        if (scrolledKeyRef.current?.overlay !== overlay || scrolledKeyRef.current.key !== scrollKey) {
          scrolledKeyRef.current = { overlay, key: scrollKey };
          material.scrollTop += overlap + 8;
        }
      }
    };
    measureRef.current = measure;
    measure("layout");
    // Zabezpieczenie: pomiar jeszcze w następnej klatce.
    const frame = requestAnimationFrame(() => measure("observer"));
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure("observer"));
    if (observer) {
      observer.observe(material);
      observer.observe(overlay);
      const content = material.querySelector<HTMLElement>(".kid-material-content");
      if (content) observer.observe(content);
      // Zmiana wysokości stopki przesuwa panel także wtedy, gdy materiał nie
      // zmienia rozmiaru (zwarty układ, spec 2026-10-30 §3.2).
      if (anchor.parentElement) observer.observe(anchor.parentElement);
    }
    return () => {
      measureRef.current = null;
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [hasDock, task.taskId, flowFeedback]);

  // Po zmianie rezerwy zakres scrolla dopiero powstaje, a pomiar, który ją
  // zlecił, nie przewijał — korekta przewinięcia następuje tutaj, od razu na
  // świeżym układzie (synchronicznie, przed malowaniem) i jeszcze w następnej
  // klatce.
  useIsomorphicLayoutEffect(() => {
    if (dockPad === 0) return;
    measureRef.current?.("layout");
    const frame = requestAnimationFrame(() => measureRef.current?.("observer"));
    return () => cancelAnimationFrame(frame);
  }, [dockPad]);

  // Rezerwa to zawsze padding pod treścią. Minimalną wysokość treści (100%
  // materiału + rezerwa) liczy CSS z `--dock-reserve`, bo inline `minHeight`
  // nie dałoby się nadpisać: w zwartym układzie (§3.2, warunek ze spec
  // 2026-10-31 §3.5) treść rośnie tylko o padding. Warunek to ta sama media
  // query co zwarty układ, w module CSS — prościej niż matchMedia w JS (pomiar
  // okna należy do KidPage) albo atrybut odczytywany ze stanu CSS. `data-dock-reserve` (ten sam warunek)
  // pozwala treści rosnąć razem z dziećmi, żeby rezerwa wydłużała przewijanie
  // materiału, który przewija się już przed werdyktem (spec 2026-10-31 §3.3).
  const reserveActive = dock !== undefined && dockPad > 0;
  const reserveStyle = reserveActive
    ? { paddingBottom: dockPad + 4, "--dock-reserve": `${dockPad}px` } as CSSProperties
    : undefined;

  return (
    <div className={`kid-exercise-frame ${classes.root}`} data-testid="kid-exercise" data-prompt-kind={task.prompt.kind} data-feedback-layout={feedbackLayout} data-action-layout={actionLayout}>
      <ExerciseInstruction instruction={presentation.instruction} icon={presentation.icon} audio={instructionAudio} guidance={guidance} />
      <div ref={materialRef} className={`kid-material ${classes.material}`} data-testid="kid-material">
        <div className={`kid-material-content ${classes.materialContent}`} style={reserveStyle} data-dock-reserve={reserveActive || undefined}>{content}</div>
      </div>
      <div className={`kid-exercise-actions ${classes.actions}`} data-testid="kid-exercise-actions">
        {/* Akcje zadania są poza AnimatePresence: fragmentu nie da się wypchnąć
            z układu, więc jako wychodzące dziecko zostawałby w stopce obok
            panelu. Znikają w tym samym commicie, w którym pojawia się panel,
            i wracają od razu po ponownej próbie, gdy panel jeszcze wychodzi. */}
        {!dock && (flowFeedback ? (
          <>
            {actions && <div data-testid="kid-primary-slot" className={classes.primary}>{actions}</div>}
            {secondaryActions && <div data-testid="kid-secondary-slot" className={classes.secondary}>{secondaryActions}</div>}
          </>
        ) : (
          <>
            {hasActions && <div data-testid="kid-primary-slot" className={classes.primary}>{actions}</div>}
            <div data-testid="kid-secondary-slot" className={classes.secondary}>{secondaryActions}</div>
          </>
        ))}
        <AnimatePresence mode="popLayout" initial={false}>
          {dock ? (flowFeedback ? <div key="kid-dock" ref={overlayRef} className={classes.flowDock}>{dock}</div> : (
            <div key="kid-dock" ref={anchorRef} className={classes.dockAnchor}>
              {hasActions && <div data-testid="kid-primary-slot" className={classes.primary} aria-hidden="true" />}
              <div data-testid="kid-secondary-slot" className={classes.secondary} aria-hidden="true" />
              <div ref={overlayRef} className={`kid-feedback-overlay ${classes.dockOverlay}`}>{dock}</div>
            </div>
          )) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
