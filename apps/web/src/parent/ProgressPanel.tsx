"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  messages,
  type ChildDto,
  type DeckSummaryDto,
  type ProgressDto,
} from "@learning/contracts";
import { apiFetch, errorMessage } from "./api";
import ProgressItems from "./ProgressItems";
import MockTestReportPanel from "./MockTestReportPanel";
import { buildSkillRows } from "./build-skill-rows";
import { dueEntries, historyRows } from "./progress-lists";
import { avatarEmoji } from "./avatars";
import { ParentIcon } from "./ParentIcon";

/**
 * Panel postępów (SPEC §25): filtrowanie dziecko × zestaw, liczby per
 * umiejętność, słowa do ćwiczeń, kierunkowe pomyłki i ostatnie odpowiedzi.
 * Wyniki wymowy pokazujemy z nazwą usługi — bez uśredniania skal.
 */

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

/** Czytelny zapis ISO daty rodzinnej (YYYY-MM-DD) bez stref czasowych. */
function formatFamilyDate(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

const now = () => new Date();

export default function ProgressPanel({
  childrenList,
  decks,
  onAuthExpired,
}: {
  childrenList: ChildDto[];
  decks: DeckSummaryDto[];
  onAuthExpired: () => void;
}) {
  const published = useMemo(() => decks.filter((deck) => deck.publishedVersionId !== null), [decks]);
  const [childId, setChildId] = useState(childrenList[0]?.id ?? "");
  const [deckId, setDeckId] = useState(published[0]?.deckId ?? "");
  const [progress, setProgress] = useState<ProgressDto | null>(null);
  const [reportVersion, setReportVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestSeq = useRef(0);

  // Wejście w zakładkę zanim listy dolecą: wybór ustawia się sam, gdy jest
  // pusty albo wskazuje usunięte dziecko/zestaw (useState sam nie podąży).
  useEffect(() => {
    if (!childId || !childrenList.some((child) => child.id === childId)) {
      setChildId(childrenList[0]?.id ?? "");
    }
  }, [childrenList, childId]);
  useEffect(() => {
    if (!deckId || !published.some((deck) => deck.deckId === deckId)) {
      setDeckId(published[0]?.deckId ?? "");
    }
  }, [published, deckId]);

  const load = useCallback(async () => {
    if (!childId || !deckId) {
      return;
    }
    const seq = ++requestSeq.current;
    setError(null);
    setLoading(true);
    try {
      const data = await apiFetch<ProgressDto>("GET", `/api/v1/parent/progress?childId=${childId}&deckId=${deckId}`);
      if (seq !== requestSeq.current) return;
      setProgress(data);
      setReportVersion(value => value + 1);
    } catch (cause) {
      if (seq !== requestSeq.current) return;
      if ((cause as { status?: number }).status === 401) {
        onAuthExpired();
        return;
      }
      setError(errorMessage(cause));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [childId, deckId, onAuthExpired]);

  // Auto-load przy zmianie filtra i przy wejściu (dawniej przycisk „Pokaż postępy”).
  useEffect(() => {
    void load();
  }, [load]);

  if (childrenList.length === 0 || published.length === 0) {
    return (
      <section>
        <h2>{messages.progress.title}</h2>
        <p className="info">{messages.progress.empty}</p>
      </section>
    );
  }

  const selectedChild = childrenList.find((child) => child.id === childId);
  /** Minuty do najbliższej pełnej, nie mniej niż 1, gdy był jakikolwiek czas. */
  const activityMinutes = progress
    ? progress.activity.activeSeconds > 0
      ? Math.max(1, Math.round(progress.activity.activeSeconds / 60))
      : 0
    : 0;

  return (
    <section>
      <div className="pp-prog-filters">
        <div className="pp-childpick" data-testid="progress-child" role="group" aria-label={messages.progress.childLabel}>
          {childrenList.map((child) => (
            <button
              key={child.id}
              type="button"
              data-testid="progress-child-option"
              aria-pressed={child.id === childId}
              className={child.id === childId ? "is-on" : undefined}
              onClick={() => setChildId(child.id)}
            >
              <span className="pp-childpick-emoji" aria-hidden="true">{avatarEmoji(child.avatarKey)}</span>
              {child.displayName}
            </button>
          ))}
        </div>
        {progress?.testDate && (
          <span className="pp-testdate">
            <ParentIcon name="calendar" />
            {fill(messages.progress.testDateBadge, { date: formatFamilyDate(progress.testDate) })}
          </span>
        )}
        <span className="pp-selectwrap">
          <label htmlFor="progress-deck-select">{messages.progress.deckLabel}</label>
          <select id="progress-deck-select" data-testid="progress-deck" value={deckId} onChange={(e) => setDeckId(e.target.value)}>
            {published.map((deck) => (
              <option key={deck.deckId} value={deck.deckId}>
                {deck.title}
              </option>
            ))}
          </select>
        </span>
      </div>
      {loading && (
        <p className="pp-loading" data-testid="progress-loading" role="status">
          {messages.progress.loading}
        </p>
      )}
      {error && (
        <p className="pp-error" data-testid="api-error" role="alert">
          {error}
        </p>
      )}

      {progress && (
        <MockTestReportPanel key={reportVersion} childId={progress.childId} deckId={progress.deckId} currentDeckVersionId={published.find(d => d.deckId === progress.deckId)?.publishedVersionId} />
      )}
      {progress && (
        <section className="card" data-testid="progress-activity">
          <h3>{fill(messages.progress.activityTitle, { days: progress.activity.days })}</h3>
          {progress.activity.sessions > 0 ? (
            <>
              <ul className="plain">
                <li data-testid="progress-activity-time">
                  {fill(messages.progress.activityTime, { minutes: activityMinutes })}
                </li>
              </ul>
              {progress.activity.daily && progress.activity.daily.length > 0 && (
                <div className="progress-activity-daily" data-testid="progress-activity-daily">
                  {progress.activity.daily.map((d, index) => {
                    const isToday = index === progress.activity.daily.length - 1;
                    const dateObj = new Date(d.date + "T12:00:00Z");
                    const weekday = messages.progress.weekdaysShort[dateObj.getUTCDay()] ?? "";
                    const label = isToday ? messages.progress.activityToday : weekday;
                    const timeText = d.activeSeconds > 0
                      ? fill(messages.progress.activityMinutesShort, { minutes: Math.max(1, Math.round(d.activeSeconds / 60)) })
                      : messages.progress.activityNoTime;
                    const ariaText = d.activeSeconds > 0
                      ? fill(messages.progress.activityDailyAria, {
                          day: weekday,
                          date: d.date,
                          time: timeText,
                        })
                      : fill(messages.progress.activityDailyAriaEmpty, {
                          day: weekday,
                          date: d.date,
                        });
                    return (
                      <div
                        key={d.date}
                        data-testid={`progress-activity-day-${d.date}`}
                        className={`progress-activity-day ${d.activeSeconds > 0 ? "progress-activity-day-active" : "progress-activity-day-empty"} ${isToday ? "progress-activity-day-today" : ""}`}
                        title={ariaText}
                        aria-label={ariaText}
                        role="group"
                      >
                        <span className="progress-activity-day-label">{label}</span>
                        <span className="progress-activity-day-time">{timeText}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="pp-stats">
                <div className="pp-stat">
                  <div className="pp-stat-v">{activityMinutes}<small> min</small></div>
                  <div className="pp-stat-l">{messages.progress.activityStatTime}</div>
                </div>
                <div className="pp-stat">
                  <div className="pp-stat-v">{progress.activity.activeDays}</div>
                  <div className="pp-stat-l">{messages.progress.activityStatDays}</div>
                </div>
                <div className="pp-stat">
                  <div className="pp-stat-v">{progress.activity.sessions}</div>
                  <div className="pp-stat-l">{messages.progress.activityStatSessions}</div>
                </div>
                <div className="pp-stat">
                  <div className="pp-stat-v">{progress.activity.answers}</div>
                  <div className="pp-stat-l">{messages.progress.activityStatAnswers}</div>
                </div>
              </div>
              {progress.activity.decks.length > 0 && (
                <ul className="plain pp-deck-rows">
                  {progress.activity.decks.map((deck) => (
                    <li key={deck.deckId}>
                      {fill(messages.progress.activityDeckRow, { title: deck.deckTitle, n: deck.sessions })}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p>{messages.progress.activityEmpty}</p>
          )}
        </section>
      )}
      {progress && (
        <>
          {selectedChild?.canRead === false && <p className="info" data-testid="progress-picture-note">{messages.progress.pictureProfileNote}</p>}
          <h3 data-testid="progress-heading">
            {progress.deckTitle} — {progress.childName}
          </h3>
          <p data-testid="progress-test-date">
            {messages.progress.testDate}:{" "}
            {progress.testDate ?? messages.progress.noTestDate}
          </p>

          <section className="pp-card" data-testid="progress-skills">
            <h3 className="pp-card-title">
              <ParentIcon name="target" />
              {messages.progress.masteryTitle}
            </h3>
            {buildSkillRows(progress).map((row) => {
              const pct = (count: number) => (row.total === 0 ? 0 : (count / row.total) * 100);
              return (
                <div className="pp-skill-row" key={row.skill}>
                  <span className="pp-skill-name">{messages.progress.skills[row.skill]}</span>
                  <span
                    className="pp-skill-bar"
                    data-testid={`progress-skill-${row.skill}`}
                    role="img"
                    aria-label={fill(messages.progress.skillBarAria, {
                      known: row.known,
                      total: row.total,
                      mastered: row.segments.mastered,
                      needs: row.segments.needsConfirmation,
                      practicing: row.segments.practicing,
                      notAssessed: row.segments.notAssessed,
                    })}
                  >
                    <span className="pp-bar-segment pp-seg-m" style={{ width: `${pct(row.segments.mastered)}%` }} />
                    <span className="pp-bar-segment pp-seg-n" style={{ width: `${pct(row.segments.needsConfirmation)}%` }} />
                    <span className="pp-bar-segment pp-seg-p" style={{ width: `${pct(row.segments.practicing)}%` }} />
                    <span className="pp-bar-segment pp-seg-x" style={{ width: `${pct(row.segments.notAssessed)}%` }} />
                  </span>
                  <span className="pp-skill-val">
                    <strong>{row.known}</strong>/{row.total}
                  </span>
                </div>
              );
            })}
            <div className="pp-legend">
              <span><i className="pp-dot pp-dot-m" />{messages.progress.legendMastered}</span>
              <span><i className="pp-dot pp-dot-n" />{messages.progress.legendNeeds}</span>
              <span><i className="pp-dot pp-dot-p" />{messages.progress.legendPracticing}</span>
              <span><i className="pp-dot pp-dot-x" />{messages.progress.legendNotAssessed}</span>
            </div>
          </section>

          <ProgressItems items={progress.items} />

          <div className="pp-card" data-testid="progress-pronunciation">
            {progress.pronunciation.assessed ? (
              <div>
                {progress.pronunciation.latestScores.map((score) => (
                  <div className="pp-pron-row" key={score.target}>
                    <span className="pp-pron-word">{score.target}</span>
                    <span className="pp-pron-track" role="img" aria-label={String(score.score)}>
                      <span style={{ width: `${Math.max(0, Math.min(100, score.score))}%` }} />
                    </span>
                    <span className="pp-pron-v">{score.score}</span>
                    <span className={`pp-chip ${score.band === "correct" ? "pp-chip-green" : score.band === "partial" ? "pp-chip-amber" : "pp-chip-gray"}`}>
                      {score.band === "correct"
                        ? messages.children.pronunciationBandCorrect
                        : score.band === "partial"
                          ? messages.children.pronunciationBandPartial
                          : messages.children.pronunciationBandBelow}
                    </span>
                  </div>
                ))}
                <p className="pp-note"><ParentIcon name="info" />{fill(messages.progress.pronunciationNote, { provider: progress.pronunciation.latestScores[0]?.provider ?? "" })}</p>
              </div>
            ) : (
              <p>{messages.progress.pronunciationNotAssessed}</p>
            )}
          </div>

          <section className="pp-card" data-testid="progress-due">
            <h3 className="pp-card-title">
              <ParentIcon name="flame" />
              {messages.progress.dueForPractice}
            </h3>
            {dueEntries(progress.items).length > 0 ? (
              <div className="pp-duelist">
                {dueEntries(progress.items).map((entry) => (
                  <span className="pp-due" key={`${entry.skill}-${entry.target}`}>
                    <ParentIcon name="arrow-right" />
                    {entry.target} <em>{messages.progress.skills[entry.skill].toLowerCase()}</em>
                  </span>
                ))}
              </div>
            ) : (
              <p>{messages.progress.dueEmpty}</p>
            )}
          </section>

          <section className="pp-card" data-testid="progress-confusions">
            <h3 className="pp-card-title">
              <ParentIcon name="shuffle" />
              {messages.progress.confusions}
            </h3>
            {progress.confusions.length > 0 ? (
              <div>
                {progress.confusions.map((confusion) => (
                  <div className="pp-conf-row" key={`${confusion.expected}-${confusion.answered}`}>
                    <ParentIcon name="arrow-right" />
                    <span>{confusion.expected} → {confusion.answered}</span>
                    <span className="pp-conf-count">{confusion.count}×</span>
                  </div>
                ))}
              </div>
            ) : (
              <p>{messages.progress.confusionsEmpty}</p>
            )}
          </section>

          <section className="pp-card" data-testid="progress-history">
            <h3 className="pp-card-title">
              <ParentIcon name="history" />
              {messages.progress.history}
            </h3>
            {progress.history.length > 0 ? (
              <div>
                {historyRows(progress.history.slice(0, 10), now()).map((row) => (
                  <div className="pp-hist-row" key={row.key}>
                    <span className={`pp-hist-ico ${row.outcome === "correct" ? "pp-hist-ok" : row.outcome === "incorrect" ? "pp-hist-bad" : "pp-hist-neutral"}`}>
                      <ParentIcon name={row.outcome === "correct" ? "check" : row.outcome === "incorrect" ? "x" : "minus"} />
                      <span className="pp-sr-only">{messages.progress.historyOutcome[row.outcome] ?? row.outcome}</span>
                    </span>
                    <span>
                      {row.source} → <strong>{row.target}</strong>
                      {row.supported && <span className="pp-hist-meta"> · {messages.progress.historyUnsupported}</span>}
                    </span>
                    <span className="pp-hist-meta">{row.when}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p>{messages.progress.historyEmpty}</p>
            )}
          </section>
        </>
      )}
    </section>
  );
}
