/**
 * fengstack.github.io - Responsive Mobile Navigation
 * Handles mobile hamburger toggle, overlay, accessibility, Esc key, and outside clicks.
 */
(function () {
  function initNav() {
    var toggleBtn = document.getElementById('navToggle');
    var navLinks = document.getElementById('navLinks');
    if (!toggleBtn || !navLinks) return;

    function openNav() {
      navLinks.classList.add('is-open');
      toggleBtn.setAttribute('aria-expanded', 'true');
      toggleBtn.classList.add('is-active');
    }

    function closeNav() {
      navLinks.classList.remove('is-open');
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleBtn.classList.remove('is-active');
    }

    toggleBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
      if (expanded) {
        closeNav();
      } else {
        openNav();
      }
    });

    // Close when clicking any nav link
    navLinks.addEventListener('click', function (e) {
      if (e.target.closest('a')) {
        closeNav();
      }
    });

    // Close on click outside
    document.addEventListener('click', function (e) {
      if (!navLinks.contains(e.target) && !toggleBtn.contains(e.target)) {
        closeNav();
      }
    });

    // Close on Escape key
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        closeNav();
      }
    });

    // Close on resize above mobile breakpoint
    window.addEventListener('resize', function () {
      if (window.innerWidth > 640 && navLinks.classList.contains('is-open')) {
        closeNav();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNav);
  } else {
    initNav();
  }
})();
