/* Isolated browser fixture. Loaded only by tests/admin.spec.py in place of the CDN SDK. */
(() => {
  const config = window.__testConfig || {};
  const seed = [
    {
      id: 1,
      name: 'Axis Robotics',
      category: 'Mainnet',
      task: 'Perp Dex',
      status: 'Potential',
      activity_status: 'Active',
      display_tag: 'Mainnet Trading',
      tge: 'Q4 2026',
      added_on: '2026-10-23',
      created_at: '2026-10-23T10:00:00Z',
      time: '20 min',
      launch_date: '2026-10-01',
      funding: '$12M',
      ecosystem: 'Base',
      cost: 'Free',
      color: '#1E90FF',
      logo_url: '',
      investors: JSON.stringify([{ title: 'Example Capital', subtitle: 'Tier 1', logo: '' }]),
      links: [
        { label: 'Website', url: 'https://example.org/' },
        { label: 'Docs', url: 'https://example.org/docs' },
      ],
      guide: [
        {
          title: 'Getting started',
          status: 'Active',
          tag: 'Daily',
          subtitle: 'Every day',
          html: '<p>Explore the project.</p><div class="guide-step-box"><a href="https://example.org/"><strong>Open project</strong></a></div>',
        },
      ],
    },
    {
      id: 2,
      name: 'Arcus',
      category: 'Airdrop',
      task: 'Points',
      status: 'Confirm',
      activity_status: 'Active',
      display_tag: 'Earn points',
      tge: 'TBA',
      added_on: '2026-10-22',
      created_at: '2026-10-22T10:00:00Z',
      time: '5 min',
      investors: 'N/A',
      guide: [],
      links: [],
    },
    {
      id: 3,
      name: 'Relay',
      category: 'Testnet',
      task: 'Testnet',
      status: 'Potential',
      activity_status: 'Ended',
      added_on: '2026-10-21',
      created_at: '2026-10-21T10:00:00Z',
      investors: '',
      guide: [{ title: 'Test tasks', status: 'Ended', html: '<p>Completed.</p>' }],
      links: [],
    },
    {
      id: 4,
      name: 'Variational',
      category: 'Mainnet',
      task: 'Perp Dex',
      status: 'Potential',
      activity_status: 'Active',
      added_on: '2026-09-20',
      created_at: '2026-09-20T10:00:00Z',
      investors: '',
      guide: [],
      links: [],
    },
    {
      id: 5,
      name: 'TitanX',
      category: 'Whitelist',
      task: 'Whitelist',
      status: 'Confirm',
      activity_status: 'Active',
      added_on: '2026-08-19',
      created_at: '2026-08-19T10:00:00Z',
      investors: '',
      guide: [],
      links: [],
    },
    {
      id: 6,
      name: 'Nova',
      category: 'Points',
      task: 'Points',
      status: 'Potential',
      activity_status: 'Active',
      added_on: '2026-07-18',
      created_at: '2026-07-18T10:00:00Z',
      investors: '',
      guide: [],
      links: [],
    },
  ];
  const mock = (window.__mock = {
    projects: structuredClone(seed),
    top: [
      { position: 1, project_id: 1 },
      { position: 2, project_id: 2 },
    ],
    calls: [],
    uploads: [],
    suppressDeletes: false,
    user: config.signedIn === false ? null : { id: 'test-admin', email: 'admin@example.test' },
    authorized: config.authorized !== false,
    level: config.level || 'aal2',
    factors: config.noFactors ? [] : [{ id: 'factor-test', status: 'verified' }],
    delayNext: null,
    failNext:
      config.failNext && !sessionStorage.getItem('test-initial-failure-seen')
        ? config.failNext
        : null,
  });
  function result(data, error = null) {
    return Promise.resolve({ data, error });
  }
  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.op = 'select';
      this.payload = null;
      this.one = false;
    }
    select() {
      return this;
    }
    eq(key, value) {
      this.filters.push((row) => String(row[key]) === String(value));
      return this;
    }
    gte(key, value) {
      this.filters.push((row) => row[key] >= value);
      return this;
    }
    order() {
      return this;
    }
    limit() {
      return this;
    }
    range() {
      return this;
    }
    single() {
      this.one = true;
      return this;
    }
    maybeSingle() {
      this.one = true;
      return this;
    }
    insert(value) {
      this.op = 'insert';
      this.payload = value;
      return this;
    }
    update(value) {
      this.op = 'update';
      this.payload = value;
      return this;
    }
    delete() {
      this.op = 'delete';
      return this;
    }
    then(resolve, reject) {
      const delay = mock.delayNext;
      if (
        delay &&
        (!delay.table || delay.table === this.table) &&
        (!delay.op || delay.op === this.op)
      ) {
        mock.delayNext = null;
        return new Promise((done) => setTimeout(done, delay.ms || 300)).then(() =>
          this.then(resolve, reject),
        );
      }
      const call = { table: this.table, op: this.op, payload: structuredClone(this.payload) };
      mock.calls.push(call);
      if (
        mock.failNext &&
        (!mock.failNext.table || mock.failNext.table === this.table) &&
        (!mock.failNext.op || mock.failNext.op === this.op)
      ) {
        const error = { message: mock.failNext.message || 'Test request failed' };
        sessionStorage.setItem('test-initial-failure-seen', 'true');
        mock.failNext = null;
        return result(null, error).then(resolve, reject);
      }
      if (this.table === 'admin_users')
        return result(mock.authorized ? { user_id: 'test-admin' } : null).then(resolve, reject);
      let source =
        this.table === 'projects'
          ? mock.projects
          : this.table === 'site_trending_items'
            ? mock.top
            : [];
      let rows = source.filter((row) => this.filters.every((filter) => filter(row)));
      if (this.op === 'insert') {
        rows = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((row) => ({
          ...structuredClone(row),
          ...(this.table === 'projects'
            ? {
                id: Math.max(0, ...source.map((p) => p.id)) + 1,
                created_at: new Date().toISOString(),
              }
            : {}),
        }));
        source.push(...rows);
      }
      if (this.op === 'update') {
        rows.forEach((row) => Object.assign(row, structuredClone(this.payload)));
      }
      if (this.op === 'delete') {
        if (!mock.suppressDeletes || this.table !== 'site_trending_items') {
          rows.forEach((row) => source.splice(source.indexOf(row), 1));
        }
      }
      return result(structuredClone(this.one ? rows[0] || null : rows)).then(resolve, reject);
    }
  }
  const auth = {
    getUser: () => result({ user: mock.user }),
    getSession: () => result({ session: mock.user ? { user: mock.user } : null }),
    signInWithPassword: async (options) => {
      mock.calls.push({ op: 'login', options });
      mock.user = { id: 'test-admin', email: options.email };
      return { data: { user: mock.user }, error: null };
    },
    signOut: async () => {
      mock.user = null;
      return { error: null };
    },
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    mfa: {
      listFactors: () => result({ totp: mock.factors }),
      getAuthenticatorAssuranceLevel: () => result({ currentLevel: mock.level, nextLevel: 'aal2' }),
      enroll: async () => {
        mock.calls.push({ op: 'mfa-enroll' });
        return {
          data: {
            id: 'enrolled-factor',
            totp: {
              qr_code: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
              secret: 'TEST-ONLY-NOT-A-CREDENTIAL',
            },
          },
          error: null,
        };
      },
      unenroll: async (options) => {
        mock.calls.push({ op: 'mfa-unenroll', options });
        mock.factors = mock.factors.filter((factor) => factor.id !== options.factorId);
        return { data: {}, error: null };
      },
      challenge: () => result({ id: 'test-challenge' }),
      verify: async (options) => {
        mock.calls.push({ op: 'mfa-verify', options });
        if (options.code !== '123456') return { error: { message: 'Invalid test code' } };
        mock.level = 'aal2';
        if (options.factorId === 'enrolled-factor') {
          mock.factors = [{ id: options.factorId, status: 'verified' }];
        }
        return { data: {}, error: null };
      },
    },
  };
  const client = {
    auth,
    from: (table) => new Query(table),
    storage: {
      from: (bucket) => ({
        upload: async (path, file, options) => {
          if (mock.delayNext?.op === 'upload') {
            const delay = mock.delayNext;
            mock.delayNext = null;
            await new Promise((done) => setTimeout(done, delay.ms || 300));
          }
          mock.uploads.push({ bucket, path, type: file.type, size: file.size, options });
          return { data: { path }, error: null };
        },
        getPublicUrl: (path) => ({ data: { publicUrl: 'https://example.test/storage/' + path } }),
      }),
    },
  };
  window.supabase = { createClient: () => client };
})();
