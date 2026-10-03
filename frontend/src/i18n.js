import React, { createContext, useContext, useMemo, useState } from 'react';
const dict = {
  fr:{search:'Rechercher',cart:'Panier',shops:'Boutiques',orders:'Commandes',seller:'Vendeur',login:'Connexion',products:'Produits',add:'Ajouter au panier',noResults:'Aucun produit trouvé.'},
  en:{search:'Search',cart:'Cart',shops:'Shops',orders:'Orders',seller:'Seller',login:'Login',products:'Products',add:'Add to cart',noResults:'No products found.'},
  pt:{search:'Pesquisar',cart:'Carrinho',shops:'Lojas',orders:'Pedidos',seller:'Vendedor',login:'Entrar',products:'Produtos',add:'Adicionar ao carrinho',noResults:'Nenhum produto encontrado.'},
  ar:{search:'بحث',cart:'السلة',shops:'المتاجر',orders:'الطلبات',seller:'البائع',login:'دخول',products:'المنتجات',add:'أضف إلى السلة',noResults:'لا توجد منتجات.'}
};
const C=createContext(null);
export function I18nProvider({children}){const [lang,setLang]=useState(()=>localStorage.getItem('baaro_lang')||'fr'); const value=useMemo(()=>({lang,setLang:(x)=>{localStorage.setItem('baaro_lang',x);setLang(x)},t:(k)=>dict[lang]?.[k]||dict.fr[k]||k,dir:lang==='ar'?'rtl':'ltr'}),[lang]); return <C.Provider value={value}>{children}</C.Provider>}
export const useI18n=()=>useContext(C);
export function LanguageSelect(){const {lang,setLang}=useI18n(); return <select value={lang} onChange={e=>setLang(e.target.value)} aria-label="Language" className="!w-auto"><option value="fr">FR</option><option value="en">EN</option><option value="pt">PT</option><option value="ar">AR</option></select>}
