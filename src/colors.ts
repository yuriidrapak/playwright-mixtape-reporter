export type Status =
    'passed' | 'failed' | 'flaky' | 'skipped' | 'interrupted' | 'notRun';
export type Tone =
    | 'lavender'
    | 'teal'
    | 'cyan'
    | 'amber'
    | 'muted'
    | 'paper'
    | 'green'
    | 'yellow'
    | 'red';

// A fixed phosphor palette: colors communicate roles and states, never animation frames.
export const palette: Record<Tone, string> = {
    lavender: '38;5;147',
    teal: '38;5;116',
    cyan: '38;5;159',
    amber: '38;5;222',
    muted: '38;5;103',
    paper: '38;5;230',
    green: '38;5;114',
    yellow: '38;5;221',
    red: '38;5;203',
};

export const statusTone: Record<Status, Tone> = {
    passed: 'green',
    failed: 'red',
    flaky: 'yellow',
    skipped: 'lavender',
    interrupted: 'amber',
    notRun: 'muted',
};
