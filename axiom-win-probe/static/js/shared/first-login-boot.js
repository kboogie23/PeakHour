(function () {
  const packaged = document.querySelector('meta[name="axiom-packaged"]')?.content === '1';
  const pro = document.querySelector('meta[name="axiom-edition"]')?.content === 'pro';
  if (packaged && pro) {
    document.documentElement.dataset.axiomLogin = 'checking';
  }
})();
