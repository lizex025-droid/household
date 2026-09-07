'use strict';

(() => {
  const applyMemberLabel = () => {
    const label = document.querySelector('.profile small');
    if (label) label.textContent = 'عضو';
  };

  const originalCloudDecorate = window.cloudDecorate;

  if (typeof originalCloudDecorate === 'function') {
    window.cloudDecorate = function (...args) {
      const result = originalCloudDecorate.apply(this, args);
      applyMemberLabel();
      return result;
    };
  }

  window.addEventListener('DOMContentLoaded', applyMemberLabel);
})();
