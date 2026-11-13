import type { Metadata } from "next";
import { DIMENSION_LABELS, DIMENSION_WEIGHTS, METHODOLOGY_VERSION, PORTFOLIO_WEIGHTS } from "@/lib/scoring/individual";
import { pct } from "@/components/ui";

export const metadata: Metadata = { title: "Method" };

const SECTIONS = [
  ["principles", "Principles"],
  ["dimensions", "Dimensions"],
  ["projects", "Project quality"],
  ["opensource", "Open-source contribution"],
  ["activity", "Activity & consistency"],
  ["impact", "Impact & reach"],
  ["breadth", "Engineering breadth"],
  ["split", "Own work vs. contribution"],
  ["teams", "Teams"],
  ["limits", "Limits"],
] as const;

export default function MethodPage() {
  return (
    <div className="wrap">
      <header className="page-head">
        <div>
          <p className="kicker">Methodology {METHODOLOGY_VERSION}</p>
          <h1>How a score is made.</h1>
          <p className="lede">
            Every number on this site can be traced to public GitHub evidence and a fixed rule written on this page. There is no curve, no cohort and no
            hidden judgement.
          </p>
        </div>
      </header>

      <div className="method-layout">
        <nav className="toc" aria-label="On this page">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </nav>

        <article className="prose">
          <h2 id="principles">Principles</h2>
          <ul>
            <li>
              <strong>One person, one context.</strong> An assessment is computed from a single account&rsquo;s evidence. No other participant&rsquo;s data is
              read, compared or used to normalise.
            </li>
            <li>
              <strong>Absolute thresholds.</strong> Every curve uses fixed reference points, so adding or removing anyone from the standings never moves
              another person&rsquo;s score. Rankings are a sort, nothing more.
            </li>
            <li>
              <strong>Diminishing returns.</strong> Counts pass through saturating log curves: the first ten merged PRs matter far more than the next hundred,
              so volume can&rsquo;t be farmed.
            </li>
            <li>
              <strong>Quality over quantity.</strong> Only an account&rsquo;s five strongest original repositories count towards project quality; forks and the
              profile README repository are excluded.
            </li>
          </ul>

          <h2 id="dimensions">Dimensions</h2>
          <p>The total is a weighted sum of five dimensions, each scored 0–100. The score ledger on every profile shows each factor&rsquo;s points.</p>
          <table className="spec">
            <thead>
              <tr>
                <th>Dimension</th>
                <th>Weight</th>
                <th>What it rewards</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{DIMENSION_LABELS.projects}</td>
                <td className="num">{pct(DIMENSION_WEIGHTS.projects)}</td>
                <td>Well-engineered, documented, maintained and adopted original work</td>
              </tr>
              <tr>
                <td>{DIMENSION_LABELS.opensource}</td>
                <td className="num">{pct(DIMENSION_WEIGHTS.opensource)}</td>
                <td>Work accepted into repositories the person does not own</td>
              </tr>
              <tr>
                <td>{DIMENSION_LABELS.activity}</td>
                <td className="num">{pct(DIMENSION_WEIGHTS.activity)}</td>
                <td>Steady contribution over the last 12 months</td>
              </tr>
              <tr>
                <td>{DIMENSION_LABELS.impact}</td>
                <td className="num">{pct(DIMENSION_WEIGHTS.impact)}</td>
                <td>Evidence that others use and follow the work</td>
              </tr>
              <tr>
                <td>{DIMENSION_LABELS.breadth}</td>
                <td className="num">{pct(DIMENSION_WEIGHTS.breadth)}</td>
                <td>Range of languages, projects and collaborations</td>
              </tr>
            </tbody>
          </table>
          <p>
            Bands: <strong>Exceptional</strong> 80+, <strong>Strong</strong> 65–80, <strong>Proficient</strong> 50–65, <strong>Developing</strong> 35–50,{" "}
            <strong>Emerging</strong> below 35.
          </p>

          <h2 id="projects">Project quality</h2>
          <p>
            Up to 24 original public repositories are inspected in depth: the ones most likely to represent the person&rsquo;s best work, by stars, forks, size,
            description and recency. Each gets a quality score out of 100, and the five best are combined with weights of{" "}
            {PORTFOLIO_WEIGHTS.map((w) => pct(w)).join(" / ")}.
          </p>
          <table className="spec">
            <thead>
              <tr>
                <th>Group</th>
                <th>Points</th>
                <th>Signals</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Documentation</td>
                <td className="num">26</td>
                <td>README size (14, square-root curve to 4 KB), description (4), topics (2), homepage (3), docs folder or site generator (3)</td>
              </tr>
              <tr>
                <td>Engineering hygiene</td>
                <td className="num">30</td>
                <td>Test suite at the root or in src/test (10), CI configuration (9), licence (7), published releases (4)</td>
              </tr>
              <tr>
                <td>Sustained development</td>
                <td className="num">20</td>
                <td>Commits by the owner on the default branch (14, log curve to 200), pushed within six months (6; three if within a year or archived)</td>
              </tr>
              <tr>
                <td>Adoption</td>
                <td className="num">24</td>
                <td>Stars (18, log curve to 1,000), forks (6, log curve to 150)</td>
              </tr>
            </tbody>
          </table>

          <h2 id="opensource">Open-source contribution</h2>
          <p>
            Contribution means work in repositories the account does not own, found with the search <code>author:login -user:login</code> across all time.
          </p>
          <table className="spec">
            <tbody>
              <tr>
                <td>Merged pull requests</td>
                <td className="num">45%</td>
                <td>
                  Merged PRs, each weighted from 0.4 (unknown project) to 1.0 (2,000+ stars) by the target&rsquo;s stature; log curve to 60 weighted PRs
                </td>
              </tr>
              <tr>
                <td>Repository reach</td>
                <td className="num">20%</td>
                <td>Distinct repositories that merged their work; log curve to 20</td>
              </tr>
              <tr>
                <td>Project stature</td>
                <td className="num">10%</td>
                <td>Stars of the most prominent repository they landed a PR in; log curve to 20,000</td>
              </tr>
              <tr>
                <td>Acceptance rate</td>
                <td className="num">10%</td>
                <td>Merged ÷ (merged + closed unmerged), smoothed and discounted below ten decided PRs</td>
              </tr>
              <tr>
                <td>Issues &amp; reviews</td>
                <td className="num">15%</td>
                <td>Issues filed elsewhere (all time) plus reviews on others&rsquo; PRs (12 months); log curve to 60</td>
              </tr>
            </tbody>
          </table>

          <h2 id="activity">Activity &amp; consistency</h2>
          <table className="spec">
            <tbody>
              <tr>
                <td>Active days</td>
                <td className="num">35%</td>
                <td>Days with at least one contribution; full marks at 220 of 365</td>
              </tr>
              <tr>
                <td>Weekly consistency</td>
                <td className="num">30%</td>
                <td>Weeks with any contribution, out of 52</td>
              </tr>
              <tr>
                <td>Volume</td>
                <td className="num">20%</td>
                <td>Total contributions; log curve to 1,500</td>
              </tr>
              <tr>
                <td>Recency</td>
                <td className="num">15%</td>
                <td>Full within 14 days of the last contribution, falling to zero at 180 days</td>
              </tr>
            </tbody>
          </table>

          <h2 id="impact">Impact &amp; reach</h2>
          <table className="spec">
            <tbody>
              <tr>
                <td>Stars earned</td>
                <td className="num">50%</td>
                <td>Across all original repositories; log curve to 5,000</td>
              </tr>
              <tr>
                <td>Followers</td>
                <td className="num">25%</td>
                <td>Log curve to 1,000</td>
              </tr>
              <tr>
                <td>Forks of own work</td>
                <td className="num">15%</td>
                <td>Log curve to 500</td>
              </tr>
              <tr>
                <td>Adopted projects</td>
                <td className="num">10%</td>
                <td>Repositories with 10+ stars; log curve to 10</td>
              </tr>
            </tbody>
          </table>

          <h2 id="breadth">Engineering breadth</h2>
          <table className="spec">
            <tbody>
              <tr>
                <td>Languages</td>
                <td className="num">40%</td>
                <td>Distinct primary languages across non-trivial original repositories; full at 8</td>
              </tr>
              <tr>
                <td>Substantial projects</td>
                <td className="num">35%</td>
                <td>Inspected repositories with quality of 45 or more; full at 8</td>
              </tr>
              <tr>
                <td>Collaboration surface</td>
                <td className="num">25%</td>
                <td>Repositories contributed to in the last 12 months; full at 25</td>
              </tr>
            </tbody>
          </table>

          <h2 id="split">Own work vs. contribution</h2>
          <p>
            Commits and pull requests from the last 12 months are split by repository owner. If 60% or more went to repositories the person doesn&rsquo;t own,
            the profile is <strong>Contributor-led</strong>; at 25% or less it is <strong>Builder-led</strong>; otherwise <strong>Balanced</strong>. Fewer
            than ten actions is reported as insufficient activity. The split describes how someone works; it doesn&rsquo;t add or remove points by itself.
          </p>

          <h2 id="teams">Teams</h2>
          <p>
            Members are assessed exactly as individuals, each in isolation. The team score is the weighted mean of their finished scores, and the team
            profile is the same weighting applied to each dimension.
          </p>
          <ul>
            <li>One member: 100% that member.</li>
            <li>Equal average: every member carries 1/n.</li>
            <li>
              Lead-weighted: the lead carries 1.2/n and the others share the rest equally. Two members: 60 / 40. Three: 40 / 30 / 30. Four: 30 / 23.3 / 23.3 /
              23.3. Five: 24 / 19 × 4. Without a designated lead the team falls back to an equal average.
            </li>
            <li>Members can be added at any time. Adding someone recalculates the weights; it never changes anyone&rsquo;s own score.</li>
          </ul>

          <h2 id="limits">Limits</h2>
          <ul>
            <li>Only public data is inspected. Private contributions appear in the activity calendar when the user has enabled it, but can&rsquo;t be examined.</li>
            <li>
              Repositories under organisations count as contribution, not own work, even when the person founded the organisation. A solo developer who
              publishes through an organisation will read as Contributor-led.
            </li>
            <li>Test detection looks at the repository root and <code>src/test</code>; tests nested deeper in a monorepo may be missed.</li>
            <li>
              Commits authored under an e-mail that isn&rsquo;t linked to the account don&rsquo;t attribute. On repositories the person owns, half of the history
              is credited instead, and the profile says so.
            </li>
            <li>
              For accounts with more than 50 merged external PRs, reach and stature are measured on a sample of 50; the count itself is always complete.
            </li>
            <li>An analysis is reused for 12 hours, then refreshed the next time it&rsquo;s requested. Any profile can be re-analysed on demand.</li>
          </ul>
        </article>
      </div>
    </div>
  );
}
