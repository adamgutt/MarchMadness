export function PoolInfo() {
  return (
    <div className="pool-info">
      <h2>🏀 March Madness Pool Setup</h2>
      <p className="pool-subtitle">Aronoff + Mandel Pools</p>

      <section className="info-section">
        <h3>Logins</h3>
        <div className="login-cards">
          <div className="login-card">
            <h4>Mandel Pool <span className="login-platform">ESPN App</span></h4>
            <div className="login-field"><span>Username:</span> aryeh.mandelbaum@gmail.com</div>
            <div className="login-field"><span>Password:</span> Letswinthis!</div>
          </div>
          <div className="login-card">
            <h4>Aronoff Pool <span className="login-platform">Splash Sports</span></h4>
            <p className="login-note">Everyone except Goose</p>
            <div className="login-field"><span>Username:</span> aryeh.mandelbaum@gmail.com</div>
            <div className="login-field"><span>Password:</span> Letswinthis!1</div>
          </div>
          <div className="login-card">
            <h4>Goose <span className="login-platform">Splash Sports</span></h4>
            <p className="login-note">2 Aronoff brackets only</p>
            <div className="login-field"><span>Username:</span> aviguttman7@gmail.com</div>
            <div className="login-field"><span>Password:</span> Letswinthis1!</div>
          </div>
        </div>
      </section>

      <div className="info-callout">
        📌 All lay (parlay) winnings — regardless of who creates the lay — are split evenly across all 6 participants. This applies to <strong>BOTH</strong> pools unless explicitly stated otherwise.
      </div>

      <section className="info-section">
        <h3>Aronoff Pool <span className="section-tag">Larger Pool</span></h3>

        <div className="tier-block">
          <h4>🥇 Tier 1: First Place OR Any Payout &gt; $2,000</h4>
          <div className="split-grid">
            <div className="split-row"><span>60%</span> Winner</div>
            <div className="split-row"><span>6% each</span> Next 5 people (30% total)</div>
            <div className="split-row"><span>10%</span> Lay / Parlay Fund</div>
          </div>
          <div className="lay-breakdown">
            <h5>Lay Fund Breakdown</h5>
            <div className="split-row"><span>20%</span> Winner personal lay</div>
            <div className="split-row"><span>70%</span> Group lay</div>
            <div className="split-row"><span>10%</span> Future group lay</div>
          </div>
        </div>

        <div className="tier-block">
          <h4>🥈 Tier 2: Second Place or Lower AND Payout &lt; $2,000</h4>
          <div className="split-grid">
            <div className="split-row"><span>75%</span> Winner</div>
            <div className="split-row"><span>25%</span> Lay / Parlay Fund</div>
          </div>
          <div className="lay-breakdown">
            <h5>Lay Fund Breakdown</h5>
            <div className="split-row"><span>10%</span> Winner personal lay</div>
            <div className="split-row"><span>75%</span> Group lay</div>
            <div className="split-row"><span>15%</span> Future group lay</div>
          </div>
        </div>
      </section>

      <section className="info-section">
        <h3>Mandel Pool <span className="section-tag">6 People</span></h3>
        <p className="pool-detail">3.5 brackets per person (3 individual + 0.5 split) · $41.66 per person</p>

        <h4 className="sub-header">Individual Brackets</h4>

        <div className="tier-block">
          <h4>🥇 First Place</h4>
          <div className="split-grid">
            <div className="split-row"><span>55%</span> Winner</div>
            <div className="split-row"><span>7% each</span> Other 5 (35% total)</div>
            <div className="split-row"><span>10%</span> Lay Fund</div>
          </div>
          <div className="lay-breakdown">
            <h5>Lay Fund Breakdown</h5>
            <div className="split-row"><span>20%</span> Winner personal</div>
            <div className="split-row"><span>70%</span> Group</div>
            <div className="split-row"><span>10%</span> Future</div>
          </div>
        </div>

        <div className="tier-block">
          <h4>🥈 Second Place or Lower</h4>
          <div className="info-callout callout-small">
            ⚠️ Update (per vote): If 2nd place payout is above $1,000, it uses the same structure as 1st place (55/35/10) — NOT 75/25.
          </div>
          <p className="tier-condition">Otherwise:</p>
          <div className="split-grid">
            <div className="split-row"><span>75%</span> Winner</div>
            <div className="split-row"><span>25%</span> Lay Fund</div>
          </div>
          <div className="lay-breakdown">
            <h5>Lay Fund Breakdown</h5>
            <div className="split-row"><span>10%</span> Winner personal</div>
            <div className="split-row"><span>75%</span> Group</div>
            <div className="split-row"><span>15%</span> Future</div>
          </div>
        </div>

        <h4 className="sub-header">Split Brackets <span className="section-tag">2 people per bracket</span></h4>

        <div className="tier-block">
          <h4>🥇 First Place</h4>
          <div className="split-grid">
            <div className="split-row"><span>30% each</span> 2 winners (60%)</div>
            <div className="split-row"><span>10% each</span> Other 4 (40%)</div>
          </div>
        </div>

        <div className="tier-block">
          <h4>🥈 Second Place or Lower</h4>
          <p className="tier-condition">If payout &gt; $1,000 — same as 1st place above</p>
          <p className="tier-condition">If payout &lt; $1,000:</p>
          <div className="split-grid">
            <div className="split-row"><span>30% each</span> Winners (60%)</div>
            <div className="split-row"><span>40%</span> Lay Fund</div>
          </div>
          <div className="lay-breakdown">
            <h5>Lay Fund Breakdown</h5>
            <div className="split-row"><span>15% each</span> Other 4 personal lays</div>
            <div className="split-row"><span>10% each</span> Winners personal lays</div>
            <div className="split-row"><span>15%</span> Group lay</div>
            <div className="split-row"><span>5%</span> Future</div>
          </div>
        </div>
      </section>

      <section className="info-section">
        <h3>Lay / Parlay Rules <span className="section-tag">Both Pools</span></h3>
        <div className="info-callout">
          <strong>Cap:</strong> Max $3,000 total in lay funds<br />
          If exceeded, extra money gets split evenly across all 6 people.
        </div>
        <div className="lay-example">
          <strong>Example:</strong> If $5,000 goes to lays →
          <ul>
            <li>$3,000 stays in lay fund</li>
            <li>$2,000 gets split evenly (~$333 each)</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
