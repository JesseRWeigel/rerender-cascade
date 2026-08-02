// The nine cases the project leads with. Each names a component and two recorded runs; every
// number in the sentence is looked up from the recording, never typed here.
export const HEADLINES = [
  {
    title: 'React.memo, defeated by one inline object',
    node: 'MemoToolbar',
    works: ['memo-stable-props', 'bump'],
    defeated: ['memo-inline-object', 'bump'],
    expectation: 'The memo is on the component either way. Adding style={{ padding: 8 }} at the call site turns it off.',
  },
  {
    title: 'React.memo, defeated by one inline arrow',
    node: 'MemoButton',
    works: ['memo-usecallback', 'bump'],
    defeated: ['memo-inline-arrow', 'bump'],
    expectation: 'The two functions have byte-identical source. React compares identity and never looks at the source.',
  },
  {
    title: 'useCallback that does nothing',
    node: 'MemoButton',
    works: ['usecallback-primitive-dep', 'bump'],
    defeated: ['usecallback-unstable-dep', 'bump'],
    expectation: 'An object in the dependency array is rebuilt every render, so the memoised callback is too.',
  },
  {
    title: 'useMemo that never hits',
    node: 'MemoTable',
    works: ['usememo-primitive-dep', 'bump'],
    defeated: ['usememo-unstable-dep', 'bump'],
    expectation: 'The expensive function still runs on every render, and the memo below it still re-renders.',
  },
  {
    title: 'A context consumer that does not use the field that changed',
    node: 'UserBadge',
    works: ['context-split', 'theme'],
    defeated: ['context-single-object', 'theme'],
    expectation: 'UserBadge reads session.user and only the theme changed. It re-renders anyway.',
  },
  {
    title: 'Unrelated state inside a provider',
    node: 'UserBadge',
    works: ['context-memo-value', 'tick'],
    defeated: ['context-unstable-value', 'tick'],
    expectation: 'The data in the context never changed. Only the object wrapping it did.',
  },
  {
    title: 'A child that skips with no memo at all',
    node: 'Expensive',
    works: ['children-as-prop', 'bump'],
    defeated: ['children-inline', 'bump'],
    expectation: 'Same components, same state, same click. The difference is which component creates the element.',
  },
  {
    title: 'React.memo on a wrapper that takes children',
    node: 'MemoPanel',
    works: ['memo-children-hoisted', 'bump'],
    defeated: ['memo-children-inline', 'bump'],
    expectation: 'children is a prop, and inline JSX makes a new element object every render.',
  },
  {
    title: 'React.memo does not stop a context update',
    node: 'ThemeReader',
    works: ['memo-blocks-parent-state', 'change'],
    defeated: ['memo-does-not-block-context', 'change'],
    expectation: 'The memo boundary bails out and the component underneath it renders anyway. The update jumps the boundary.',
  },
];
