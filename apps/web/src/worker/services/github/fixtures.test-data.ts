export const receivedAt = '2026-10-10T12:00:00.000Z';
export const repository = { id: 42 };
export const sender = { id: 100, login: 'pusher' };
export const pushFixture = {
  repository,
  sender,
  ref: 'refs/heads/hk-12-feature',
  created: false,
  deleted: false,
  commits: [
    {
      id: 'abc123',
      message: 'Add café support\nDetails',
      timestamp: '2026-10-10T10:00:00-04:00',
      url: 'https://github.com/team/repo/commit/abc123',
      author: { email: '200+author@users.noreply.github.com', username: 'author' },
    },
  ],
};
export const prFixture = {
  repository,
  sender,
  action: 'opened',
  pull_request: {
    number: 12,
    title: 'HK-12: add feature',
    html_url: 'https://github.com/team/repo/pull/12',
    head: { ref: 'hk-12-feature', sha: 'abc123' },
    updated_at: receivedAt,
    merged: false,
    merged_at: null,
    closed_at: null,
    additions: 10,
    deletions: 2,
  },
};
