import { messages, REPORT_SKILLS, type ProgressItemDto } from "@learning/contracts";

/** Dwa układy tego samego raportu; ukryty układ nie trafia do drzewa dostępności. */
export default function ProgressItems({ items }: { items: ProgressItemDto[] }) {
  return (
    <section className="progress-items" aria-labelledby="progress-items-heading">
      <h3 id="progress-items-heading">{messages.progress.allWords}</h3>
      {items.length === 0 ? <p>{messages.progress.wordsEmpty}</p> : (
        <>
          <table className="progress-items-table">
            <thead>
              <tr>
                <th scope="col">{messages.progress.targetWord}</th>
                <th scope="col">{messages.progress.sourceWord}</th>
                {REPORT_SKILLS.map((skill) => (
                  <th scope="col" key={skill}>{messages.progress.skills[skill]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.itemId}>
                  <th scope="row">
                    <span lang="en-GB">{item.target}</span>
                    {item.meaningChanged && <small className="progress-material-changed">{messages.progress.materialChanged}</small>}
                  </th>
                  <td>{item.source}</td>
                  {REPORT_SKILLS.map((skill) => (
                    <td key={skill}>
                      <span className={`progress-status progress-status-${item.skills[skill]}`}>
                        {messages.progress.itemStatus[item.skills[skill]]}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="plain progress-items-cards">
            {items.map((item) => (
              <li className="card" key={item.itemId}>
                <h4><span lang="en-GB">{item.target}</span> — {item.source}</h4>
                {item.meaningChanged && <p className="progress-material-changed">{messages.progress.materialChanged}</p>}
                <dl>
                  {REPORT_SKILLS.map((skill) => (
                    <div key={skill}>
                      <dt>{messages.progress.skills[skill]}</dt>
                      <dd>
                        <span className={`progress-status progress-status-${item.skills[skill]}`}>
                          {messages.progress.itemStatus[item.skills[skill]]}
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
