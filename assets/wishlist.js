document.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("saved-products");
  if (!container) return;

  const saved = JSON.parse(localStorage.getItem("savedProductVariants")) || [];
  if (saved.length === 0) {
    container.innerHTML = '<p>Немає збережених товарів</p>';
    return;
  }

  const allProducts = await fetch('/products.json')
    .then(res => res.json())
    .then(data => data.products || []);

  saved.forEach((item) => {
    const variantId = parseInt(item.id);
    let foundProduct = null;
    let foundVariant = null;

    for (const product of allProducts) {
      const variant = product.variants.find(v => v.id === variantId);
      if (variant) {
        foundProduct = product;
        foundVariant = variant;
        break;
      }
    }

    if (!foundProduct || !foundVariant) return;

    console.log(foundVariant, 'variant');
    console.log(foundProduct, 'foundProduct');

    const isMainProduct = !item.hasOwnProperty("options[Color]");

    const title = foundVariant.title || foundProduct.title;
    const image = foundVariant.featured_image?.src || foundProduct.images[0]?.src || foundProduct.featured_image || '';

    const rawPrice = foundVariant.price || foundProduct.price;
    const price = new Intl.NumberFormat('uk-UA', {
      style: 'currency',
      currency: Shopify.currency.active || 'UAH',
      minimumFractionDigits: 2
    }).format(rawPrice);

    const link = foundVariant ? 
      `/products/${foundProduct.handle}?variant=${variantId}` : 
      `/products/${foundProduct.handle}`;

    const productHTML = `
      <div class="product-item relative product-wrapper" data-variant-id="${variantId}">
        <a href="${link}" class="full-absolute"> </a>

        <div class="image-wrapper">
          <img width="300" height="300" src="${image}" alt="${title}" class="product-image">
        </div>

        <div class="product-details">
          ${!isMainProduct ? `<div class="product-options">
            ${Object.entries(item)
              .filter(([key]) => key.startsWith("options["))
              .map(([key, val]) => `<span>${key.replace(/^options\[|\]$/g, "")}: ${val}</span>`)
              .join(" / ")}
          </div>` : ""}

          <h3 class="product-title">${title}</h3>

          <div class="flex product-price">
            <div>${price}</div>
            <div class="ml-15px">${Shopify.currency.active || "USD"}</div>
          </div>

          <form class="unsave-form" data-variant-id="${variantId}">
            <input type="hidden" name="id" value="${variantId}">
            <button type="submit" class="button unsave-button">Unsave</button>
          </form>
        </div>
      </div>
`;
    container.insertAdjacentHTML("beforeend", productHTML);
  });

  document.querySelectorAll('.unsave-form').forEach(form => {
    form.addEventListener('submit', function (e) {
      e.preventDefault();

      const variantId = e.target.dataset.variantId;
      const saved = JSON.parse(localStorage.getItem('savedProductVariants')) || [];
      const updated = saved.filter(item => String(item.id) !== String(variantId));
      localStorage.setItem('savedProductVariants', JSON.stringify(updated));

      const productElement = e.target.closest('.product-item');
      if (productElement) productElement.remove();
      updateSavedCount()
    });
  });
});





