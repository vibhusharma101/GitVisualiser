import React from 'react';

function App() {
  const handleClick = () => {
    throw new Error('This is a Sentry test error.');
  };

  return (
    <div>
      <h1>Git Visualiser</h1>
      <button onClick={handleClick}>Trigger Error</button>
    </div>
  );
}

export default App;