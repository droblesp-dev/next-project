/**
 * NEXTPROJECT - CENTRO DE MECANIZADO INDUSTRIAL
 * Implementación fiel y exacta del prototipo Stitch
 */

import React, { useState, useRef } from 'react';
import piezasMecanizadasImg from './assets/images/piezas_mecanizadas_1788228769715.jpg';
import tornoGalleryImg from './assets/images/torno_industrial_gallery_1788229002934.jpg';
import fabricacionGalleryImg from './assets/images/fabricacion_gallery_1788229017518.jpg';

export default function App() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeNav, setActiveNav] = useState('inicio');

  // Form State
  const [formData, setFormData] = useState({
    nombre: '',
    empresa: '',
    telefono: '',
    email: '',
    servicio: 'SELECCIONE UN SERVICIO',
    descripcion: '',
    cantidad: '',
    fecha: '',
  });

  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [formSubmitted, setFormSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalType, setModalType] = useState<'terminos' | 'privacidad' | 'galeria' | 'asistente_ia' | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiTechnicalSpec, setAiTechnicalSpec] = useState<string | null>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setPhotoFiles(Array.from(e.target.files));
    }
  };

  const handlePdfUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setPdfFiles(Array.from(e.target.files));
    }
  };

  const handleSelectServiceFromCard = (serviceName: string) => {
    setFormData((prev) => ({ ...prev, servicio: serviceName }));
    const target = document.getElementById('cotizacion');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    setTimeout(() => {
      setIsSubmitting(false);
      setFormSubmitted(true);

      // Build WhatsApp message for instant follow-up
      const message = `*SOLICITUD DE COTIZACIÓN - NEXTPROJECT*%0A%0A*Cliente:* ${encodeURIComponent(formData.nombre || 'No especificado')}%0A*Empresa:* ${encodeURIComponent(formData.empresa || 'N/A')}%0A*Teléfono:* ${encodeURIComponent(formData.telefono || 'N/A')}%0A*Email:* ${encodeURIComponent(formData.email || 'N/A')}%0A*Servicio:* ${encodeURIComponent(formData.servicio)}%0A*Cantidad:* ${encodeURIComponent(formData.cantidad || '1')}%0A*Fecha Requerida:* ${encodeURIComponent(formData.fecha || 'Lo antes posible')}%0A*Descripción:* ${encodeURIComponent(formData.descripcion || 'Sin descripción adicional')}%0A*Archivos adjuntos:* ${photoFiles.length} foto(s), ${pdfFiles.length} documento(s)`;

      const whatsappUrl = `https://wa.me/593939067666?text=${message}`;
      
      // Open WhatsApp in new tab after 1 second if wanted
      setTimeout(() => {
        window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
      }, 800);
    }, 600);
  };

  const navLinks = [
    { name: 'INICIO', href: '#inicio', id: 'inicio' },
    { name: 'NOSOTROS', href: '#nosotros', id: 'nosotros' },
    { name: 'SERVICIOS', href: '#servicios', id: 'servicios' },
    { name: 'PROCESO', href: '#proceso', id: 'proceso' },
    { name: 'TRABAJOS', href: '#trabajos', id: 'trabajos' },
    { name: 'COTIZACIÓN', href: '#cotizacion', id: 'cotizacion' },
    { name: 'CONTACTO', href: '#contacto', id: 'contacto' },
  ];

  return (
    <div className="bg-background text-on-surface font-body-md antialiased selection:bg-primary-container selection:text-on-primary-container min-h-screen">
      {/* 1. HEADER (TopNavBar Shared Component adapted) */}
      <header className="bg-background dark:bg-background border-b border-surface-container-highest docked full-width top-0 sticky z-50">
        <div className="flex justify-between items-center w-full px-margin-mobile md:px-margin-desktop py-4 max-w-container-max mx-auto">
          {/* Brand */}
          <a
            className="font-headline-lg text-headline-lg-mobile md:text-headline-lg font-black text-on-surface uppercase tracking-tighter flex items-center"
            href="#inicio"
            onClick={() => setActiveNav('inicio')}
          >
            <span>NEXT</span>
            <span className="text-primary-container">PROJECT</span>
          </a>

          {/* Navigation (Desktop) */}
          <nav className="hidden lg:flex items-center space-x-6">
            {navLinks.map((link) => (
              <a
                key={link.id}
                className={`font-label-caps text-label-caps transition-colors ${
                  activeNav === link.id
                    ? 'text-primary-container border-b-2 border-primary-container pb-1'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
                href={link.href}
                onClick={() => setActiveNav(link.id)}
              >
                {link.name}
              </a>
            ))}
          </nav>

          {/* Trailing Action */}
          <div className="hidden md:block">
            <a
              className="inline-flex items-center justify-center px-4 py-2 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-label-caps text-label-caps cursor-pointer"
              href="https://wa.me/593939067666?text=Hola%20NEXTPROJECT,%20deseo%20solicitar%20una%20cotizaci%C3%B3n%20para%20un%20trabajo%20de%20mecanizado%20industrial."
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="material-symbols-outlined mr-2 text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                chat
              </span>
              COTIZAR POR WHATSAPP
            </a>
          </div>

          {/* Mobile Menu Toggle */}
          <button
            className="lg:hidden text-on-surface p-2 focus:outline-none"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Menú principal"
          >
            <span className="material-symbols-outlined">{mobileMenuOpen ? 'close' : 'menu'}</span>
          </button>
        </div>

        {/* Mobile Navigation Menu Dropdown */}
        {mobileMenuOpen && (
          <div className="lg:hidden bg-surface border-b border-outline px-margin-mobile py-4 space-y-3">
            {navLinks.map((link) => (
              <a
                key={link.id}
                className={`block font-label-caps text-label-caps py-2 ${
                  activeNav === link.id ? 'text-primary-container font-bold' : 'text-on-surface-variant'
                }`}
                href={link.href}
                onClick={() => {
                  setActiveNav(link.id);
                  setMobileMenuOpen(false);
                }}
              >
                {link.name}
              </a>
            ))}
            <div className="pt-2 border-t border-outline">
              <a
                className="w-full inline-flex items-center justify-center px-4 py-2 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-label-caps text-label-caps"
                href="https://wa.me/593939067666?text=Hola%20NEXTPROJECT,%20deseo%20solicitar%20una%20cotizaci%C3%B3n%20para%20un%20trabajo%20de%20mecanizado%20industrial."
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="material-symbols-outlined mr-2 text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  chat
                </span>
                COTIZAR POR WHATSAPP
              </a>
            </div>
          </div>
        )}
      </header>

      {/* 2. HERO */}
      <section className="relative w-full min-h-[80vh] flex items-center bg-background overflow-hidden border-b border-outline" id="inicio">
        <div className="absolute inset-0 w-full h-full lg:w-1/2 lg:right-0 lg:left-auto opacity-30 lg:opacity-100 z-0">
          <img
            className="w-full h-full object-cover grayscale-[20%] sepia-[10%] brightness-75"
            data-alt="Professional high-quality photography of a large industrial lathe (torno industrial) machining a large metal component. Visible metal shavings (viruta), cutting tool, and sparks. Industrial workshop setting, dramatic lighting, dark background, technical precision. Real industrial machining process. No hand tools."
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuAxINyOYyKfP0ZUyKFcoPaAwjwKr1IClCcJmq_beVHrU-Se8gQIrv7VRk9GckQc-nMCcFvn5ib00VjaZvSVUXvHZFfs0-vZnf4pV4G9LbIJcV07UH-mDkOg_UV6_EZ1285UrFCNZzefSuKqpSZGn18tmyGnNokIylnqklviDBJNJiM77Pn0PzjT29VTdIuV1YVjPBRccgipPfkEQvBxQauoGSTijovTNCtCCoB-FY9GrjOeAOCVyBXS"
            alt="Torno industrial de mecanizado de precisión"
          />
          {/* Fade gradient for text legibility on desktop */}
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-transparent lg:w-1/3"></div>
        </div>
        <div className="relative z-10 w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-16 lg:py-0 grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="flex flex-col justify-center pl-4 border-l-4 border-primary-container">
            <h1 className="font-display-lg text-headline-lg-mobile md:text-display-lg font-black uppercase text-on-surface flex flex-col leading-none mb-6">
              <span>CENTRO DE</span>
              <span className="text-primary-container">MECANIZADO</span>
              <span>INDUSTRIAL</span>
            </h1>
            <h2 className="font-headline-md text-body-lg md:text-headline-md text-on-surface-variant font-semibold mb-4 uppercase">
              SOLUCIONES PARA LA INDUSTRIA
            </h2>
            <p className="font-body-lg text-body-md md:text-body-lg text-on-surface-variant mb-8 max-w-md">
              Fabricación, reparación y mecanizado de componentes según los requerimientos de cada proyecto.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <a
                className="inline-flex items-center justify-center px-6 py-4 bg-primary-container text-on-primary-container font-label-caps text-label-caps hover:bg-primary-fixed-dim transition-colors"
                href="#cotizacion"
                onClick={() => setActiveNav('cotizacion')}
              >
                <span className="material-symbols-outlined mr-2 text-[18px]">request_quote</span>
                SOLICITAR COTIZACIÓN
              </a>
              <a
                className="inline-flex items-center justify-center px-6 py-4 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-label-caps text-label-caps"
                href="#servicios"
                onClick={() => setActiveNav('servicios')}
              >
                VER SERVICIOS
                <span className="material-symbols-outlined ml-2 text-[18px]">arrow_forward</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* 3. INDUSTRIAL BAND / FRANJA INDUSTRIAL DE SEGURIDAD */}
      <div
        id="franja-seguridad-hero"
        className="w-full h-4 hazard-stripe bg-hazard-stripe block z-10 relative"
        style={{
          backgroundImage:
            'repeating-linear-gradient(45deg, #fabd00, #fabd00 10px, #000000 10px, #000000 20px)',
        }}
      ></div>

      {/* 4. QUIÉNES SOMOS */}
      <section className="w-full bg-surface py-20 border-b border-outline" id="nosotros">
        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="relative sharp-border p-2">
            <img
              alt="Professional high-quality photography of a large conventional industrial metal lathe in a workshop"
              className="w-full h-auto object-cover grayscale hover:grayscale-0 transition-all duration-500"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuCJVxc1pANjAnJ16iDfWb64WvTbbcPO3taz5_8SNYB0tpbHrOTM0WxUT-jl_ZAV9monNgtt4MvE_ihxPCiNTdK__WS68nOoAyYO9TjYvPXL2KP67SLrpXi-ZgNEa-R1BxFGQ-1-9D1RVOLMO9sS8CjsWtWMgEQDAhOgm2yHvu-np2w9aTXE04Gp2UKq3sxo7hlLXPy76Gf00yqABzKdaWFS7P_ngQxN9KaKcR6gjORulioSARS6IeXO"
            />
            <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-primary-container flex items-center justify-center">
              <span className="material-symbols-outlined text-on-primary-container text-4xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                precision_manufacturing
              </span>
            </div>
          </div>
          <div>
            <div className="flex items-center mb-4">
              <div className="w-8 h-[2px] bg-primary-container mr-4"></div>
              <h3 className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase">ACERCA DE</h3>
            </div>
            <h2 className="font-headline-lg text-headline-lg-mobile md:text-headline-lg font-bold text-on-surface uppercase mb-6">
              QUIÉNES SOMOS
            </h2>
            <p className="font-body-md text-body-md text-on-surface-variant mb-6">
              NEXTPROJECT es un centro de mecanizado industrial orientado a brindar soluciones de fabricación, reparación y mecanizado de componentes para empresas, contratistas y clientes que requieren trabajos bajo medidas, muestras o especificaciones técnicas.
            </p>
            <p className="font-body-md text-body-md text-on-surface-variant mb-8">
              Nuestro compromiso es ofrecer soluciones precisas y funcionales, adaptadas a las necesidades de cada proyecto, desde la fabricación de componentes hasta la recuperación de piezas para prolongar su vida útil.
            </p>
            <ul className="space-y-4 font-code-sm text-code-sm text-on-surface uppercase">
              <li className="flex items-center border-b border-outline pb-2">
                <span className="material-symbols-outlined text-primary-container mr-4 text-[18px]">check_box</span>
                MECANIZADO CONVENCIONAL: Torno y fresado industrial
              </li>
              <li className="flex items-center border-b border-outline pb-2">
                <span className="material-symbols-outlined text-primary-container mr-4 text-[18px]">check_box</span>
                FABRICACIÓN A MEDIDA: Piezas bajo plano o muestra
              </li>
              <li className="flex items-center border-b border-outline pb-2">
                <span className="material-symbols-outlined text-primary-container mr-4 text-[18px]">check_box</span>
                CONTROL Y REVISIÓN: Verificación del trabajo realizado
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* 5. NUESTROS SERVICIOS (Cards) */}
      <section className="w-full bg-background py-20 border-b border-outline" id="servicios">
        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
          <div className="flex flex-col md:flex-row md:justify-between md:items-end mb-12 border-l-4 border-primary-container pl-4">
            <div>
              <h3 className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase mb-2">ESPECIALIDADES</h3>
              <h2 className="font-headline-lg text-headline-lg-mobile md:text-headline-lg font-bold text-on-surface uppercase">
                NUESTROS SERVICIOS
              </h2>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1 */}
            <div className="bg-surface sharp-border p-6 flex flex-col group hover:border-primary-container transition-colors">
              <div className="flex justify-between items-start mb-8 border-b border-outline pb-4">
                <span className="font-code-sm text-code-sm text-on-surface-variant">01</span>
                <span className="material-symbols-outlined text-primary-container text-3xl group-hover:scale-110 transition-transform">
                  construction
                </span>
              </div>
              <h4 className="font-headline-md text-headline-md text-on-surface uppercase mb-4">TORNO INDUSTRIAL</h4>
              <p className="font-body-md text-body-md text-on-surface-variant mb-8 flex-grow">
                Mecanizado de componentes cilíndricos para ejes, bujes, bridas y piezas rotativas.
              </p>
              <button
                onClick={() => handleSelectServiceFromCard('TORNO INDUSTRIAL')}
                className="inline-flex items-center justify-between w-full border border-outline px-4 py-2 font-label-caps text-label-caps text-on-surface group-hover:bg-primary-container group-hover:text-on-primary-container group-hover:border-primary-container transition-all cursor-pointer text-left"
              >
                SOLICITAR COTIZACIÓN
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </button>
            </div>

            {/* Card 2 */}
            <div className="bg-surface sharp-border p-6 flex flex-col group hover:border-primary-container transition-colors">
              <div className="flex justify-between items-start mb-8 border-b border-outline pb-4">
                <span className="font-code-sm text-code-sm text-on-surface-variant">02</span>
                <span className="material-symbols-outlined text-primary-container text-3xl group-hover:scale-110 transition-transform">
                  settings_overscan
                </span>
              </div>
              <h4 className="font-headline-md text-headline-md text-on-surface uppercase mb-4">FRESADO INDUSTRIAL</h4>
              <p className="font-body-md text-body-md text-on-surface-variant mb-8 flex-grow">
                Mecanizado de superficies planas, ranuras, engranajes y perfiles complejos con tolerancias específicas.
              </p>
              <button
                onClick={() => handleSelectServiceFromCard('FRESADO INDUSTRIAL')}
                className="inline-flex items-center justify-between w-full border border-outline px-4 py-2 font-label-caps text-label-caps text-on-surface group-hover:bg-primary-container group-hover:text-on-primary-container group-hover:border-primary-container transition-all cursor-pointer text-left"
              >
                SOLICITAR COTIZACIÓN
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </button>
            </div>

            {/* Card 3 */}
            <div className="bg-surface sharp-border p-6 flex flex-col group hover:border-primary-container transition-colors">
              <div className="flex justify-between items-start mb-8 border-b border-outline pb-4">
                <span className="font-code-sm text-code-sm text-on-surface-variant">03</span>
                <span className="material-symbols-outlined text-primary-container text-3xl group-hover:scale-110 transition-transform">
                  precision_manufacturing
                </span>
              </div>
              <h4 className="font-headline-md text-headline-md text-on-surface uppercase mb-4">FABRICACIÓN</h4>
              <p className="font-body-md text-body-md text-on-surface-variant mb-8 flex-grow">
                Desarrollo y manufactura de piezas a medida a partir de planos, muestras o requerimientos específicos.
              </p>
              <button
                onClick={() => handleSelectServiceFromCard('FABRICACIÓN DE PIEZA NUEVA')}
                className="inline-flex items-center justify-between w-full border border-outline px-4 py-2 font-label-caps text-label-caps text-on-surface group-hover:bg-primary-container group-hover:text-on-primary-container group-hover:border-primary-container transition-all cursor-pointer text-left"
              >
                SOLICITAR COTIZACIÓN
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </button>
            </div>

            {/* Card 4 */}
            <div className="bg-surface sharp-border p-6 flex flex-col group hover:border-primary-container transition-colors">
              <div className="flex justify-between items-start mb-8 border-b border-outline pb-4">
                <span className="font-code-sm text-code-sm text-on-surface-variant">04</span>
                <span className="material-symbols-outlined text-primary-container text-3xl group-hover:scale-110 transition-transform">
                  build
                </span>
              </div>
              <h4 className="font-headline-md text-headline-md text-on-surface uppercase mb-4">REPARACIÓN Y RECUPERACIÓN</h4>
              <p className="font-body-md text-body-md text-on-surface-variant mb-8 flex-grow">
                Restauración de componentes desgastados o dañados, devolviéndolos a sus especificaciones operativas.
              </p>
              <button
                onClick={() => handleSelectServiceFromCard('REPARACIÓN / RECUPERACIÓN')}
                className="inline-flex items-center justify-between w-full border border-outline px-4 py-2 font-label-caps text-label-caps text-on-surface group-hover:bg-primary-container group-hover:text-on-primary-container group-hover:border-primary-container transition-all cursor-pointer text-left"
              >
                SOLICITAR COTIZACIÓN
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 6. SOLUCIONES PARA SUS NECESIDADES INDUSTRIALES */}
      <section className="w-full bg-surface py-20 border-b border-outline" id="soluciones">
        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="flex items-center mb-4">
              <div className="w-8 h-[2px] bg-primary-container mr-4"></div>
              <h3 className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase">APLICACIONES</h3>
            </div>
            <h2 className="font-headline-lg text-headline-lg-mobile md:text-headline-lg font-bold text-on-surface uppercase mb-6">
              SOLUCIONES PARA SUS NECESIDADES INDUSTRIALES
            </h2>
            <p className="font-body-md text-body-md text-on-surface-variant mb-8">
              Atendemos requerimientos de fabricación, reposición y recuperación de componentes para diferentes aplicaciones industriales.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-code-sm text-code-sm text-on-surface uppercase">
              <div className="flex items-center border-b border-outline pb-2">
                <span className="material-symbols-outlined text-primary-container mr-3 text-[18px]">check_box</span>
                REPUESTOS INDUSTRIALES
              </div>
              <div className="flex items-center border-b border-outline pb-2">
                <span className="material-symbols-outlined text-primary-container mr-3 text-[18px]">check_box</span>
                MANTENIMIENTO DE MAQUINARIA
              </div>
              <div className="flex items-center border-b border-outline pb-2">
                <span className="material-symbols-outlined text-primary-container mr-3 text-[18px]">check_box</span>
                COMPONENTES PARA EQUIPOS
              </div>
              <div className="flex items-center border-b border-outline pb-2">
                <span className="material-symbols-outlined text-primary-container mr-3 text-[18px]">check_box</span>
                PIEZAS BAJO PLANO O MUESTRA
              </div>
              <div className="flex items-center border-b border-outline pb-2">
                <span className="material-symbols-outlined text-primary-container mr-3 text-[18px]">check_box</span>
                RECUPERACIÓN DE COMPONENTES
              </div>
              <div className="flex items-center border-b border-outline pb-2">
                <span className="material-symbols-outlined text-primary-container mr-3 text-[18px]">check_box</span>
                SOLUCIONES ESPECIALES
              </div>
            </div>
          </div>
          <div className="relative sharp-border p-2">
            <img
              alt="Piezas y componentes industriales mecanizados"
              className="w-full h-auto object-cover grayscale hover:grayscale-0 transition-all duration-500"
              src={piezasMecanizadasImg}
            />
          </div>
        </div>
      </section>

      {/* 7. SECTORES QUE ATENDEMOS */}
      <section className="w-full bg-background py-20 border-b border-outline" id="sectores">
        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
          <div className="text-center mb-12">
            <h3 className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase mb-2">ALCANCE</h3>
            <h2 className="font-headline-lg text-headline-lg-mobile md:text-headline-lg font-bold text-on-surface uppercase">
              SECTORES QUE ATENDEMOS
            </h2>
          </div>
          <div className="flex flex-wrap justify-center gap-4">
            <div className="bg-surface sharp-border p-6 flex flex-col items-center justify-center text-center group hover:border-primary-container transition-colors w-full md:w-[calc(33.333%-1rem)] lg:w-[calc(25%-1rem)]">
              <span className="material-symbols-outlined text-primary-container text-4xl mb-4 group-hover:scale-110 transition-transform">
                factory
              </span>
              <span className="font-label-caps text-label-caps text-on-surface uppercase">INDUSTRIA</span>
            </div>
            <div className="bg-surface sharp-border p-6 flex flex-col items-center justify-center text-center group hover:border-primary-container transition-colors w-full md:w-[calc(33.333%-1rem)] lg:w-[calc(25%-1rem)]">
              <span className="material-symbols-outlined text-primary-container text-4xl mb-4 group-hover:scale-110 transition-transform">
                engineering
              </span>
              <span className="font-label-caps text-label-caps text-on-surface uppercase">MANTENIMIENTO INDUSTRIAL</span>
            </div>
            <div className="bg-surface sharp-border p-6 flex flex-col items-center justify-center text-center group hover:border-primary-container transition-colors w-full md:w-[calc(33.333%-1rem)] lg:w-[calc(25%-1rem)]">
              <span className="material-symbols-outlined text-primary-container text-4xl mb-4 group-hover:scale-110 transition-transform">
                precision_manufacturing
              </span>
              <span className="font-label-caps text-label-caps text-on-surface uppercase">MAQUINARIA</span>
            </div>
            <div className="bg-surface sharp-border p-6 flex flex-col items-center justify-center text-center group hover:border-primary-container transition-colors w-full md:w-[calc(33.333%-1rem)] lg:w-[calc(25%-1rem)]">
              <span className="material-symbols-outlined text-primary-container text-4xl mb-4 group-hover:scale-110 transition-transform">
                construction
              </span>
              <span className="font-label-caps text-label-caps text-on-surface uppercase">CONSTRUCCIÓN</span>
            </div>
            <div className="bg-surface sharp-border p-6 flex flex-col items-center justify-center text-center group hover:border-primary-container transition-colors w-full md:w-[calc(33.333%-1rem)] lg:w-[calc(25%-1rem)]">
              <span className="material-symbols-outlined text-primary-container text-4xl mb-4 group-hover:scale-110 transition-transform">
                agriculture
              </span>
              <span className="font-label-caps text-label-caps text-on-surface uppercase">AGROINDUSTRIA</span>
            </div>
            <div className="bg-surface sharp-border p-6 flex flex-col items-center justify-center text-center group hover:border-primary-container transition-colors w-full md:w-[calc(33.333%-1rem)] lg:w-[calc(25%-1rem)]">
              <span className="material-symbols-outlined text-primary-container text-4xl mb-4 group-hover:scale-110 transition-transform">
                local_shipping
              </span>
              <span className="font-label-caps text-label-caps text-on-surface uppercase">TRANSPORTE</span>
            </div>
            <div className="bg-surface sharp-border p-6 flex flex-col items-center justify-center text-center group hover:border-primary-container transition-colors w-full md:w-[calc(33.333%-1rem)] lg:w-[calc(25%-1rem)]">
              <span className="material-symbols-outlined text-primary-container text-4xl mb-4 group-hover:scale-110 transition-transform">
                handyman
              </span>
              <span className="font-label-caps text-label-caps text-on-surface uppercase">CONTRATISTAS</span>
            </div>
          </div>
        </div>
      </section>

      {/* 8. NUESTRO PROCESO */}
      <section className="w-full bg-surface py-20 border-b border-outline" id="proceso">
        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
          <div className="border-l-4 border-primary-container pl-4 mb-16">
            <h3 className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase mb-2">METODOLOGÍA</h3>
            <h2 className="font-headline-lg text-headline-lg-mobile md:text-headline-lg font-bold text-on-surface uppercase">
              NUESTRO PROCESO
            </h2>
          </div>
          <div className="relative flex flex-col md:flex-row justify-between items-start md:items-center space-y-8 md:space-y-0">
            {/* Horizontal line for desktop */}
            <div className="absolute left-0 right-0 top-6 h-[2px] bg-outline z-0 hidden md:block"></div>
            {/* Vertical line for mobile */}
            <div className="absolute left-6 top-0 bottom-0 w-[2px] bg-outline z-0 md:hidden block"></div>

            {/* Step 1 */}
            <div className="relative z-10 flex flex-row md:flex-col items-center group">
              <div className="w-12 h-12 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center font-headline-md font-bold text-lg border-4 border-surface group-hover:scale-110 transition-transform">
                01
              </div>
              <div className="ml-6 md:ml-0 md:mt-4 md:text-center">
                <h4 className="font-label-caps text-label-caps text-on-surface uppercase">SOLICITUD</h4>
                <p className="font-code-sm text-code-sm text-on-surface-variant mt-1">Recepción del requerimiento</p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="relative z-10 flex flex-row md:flex-col items-center group">
              <div className="w-12 h-12 rounded-full bg-surface-container-high text-primary-container flex items-center justify-center font-headline-md font-bold text-lg border-4 border-outline group-hover:border-primary-container transition-colors">
                02
              </div>
              <div className="ml-6 md:ml-0 md:mt-4 md:text-center">
                <h4 className="font-label-caps text-label-caps text-on-surface uppercase">EVALUACIÓN</h4>
                <p className="font-code-sm text-code-sm text-on-surface-variant mt-1">Análisis técnico</p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="relative z-10 flex flex-row md:flex-col items-center group">
              <div className="w-12 h-12 rounded-full bg-surface-container-high text-primary-container flex items-center justify-center font-headline-md font-bold text-lg border-4 border-outline group-hover:border-primary-container transition-colors">
                03
              </div>
              <div className="ml-6 md:ml-0 md:mt-4 md:text-center">
                <h4 className="font-label-caps text-label-caps text-on-surface uppercase">COTIZACIÓN</h4>
                <p className="font-code-sm text-code-sm text-on-surface-variant mt-1">Propuesta comercial</p>
              </div>
            </div>

            {/* Step 4 */}
            <div className="relative z-10 flex flex-row md:flex-col items-center group">
              <div className="w-12 h-12 rounded-full bg-surface-container-high text-primary-container flex items-center justify-center font-headline-md font-bold text-lg border-4 border-outline group-hover:border-primary-container transition-colors">
                04
              </div>
              <div className="ml-6 md:ml-0 md:mt-4 md:text-center">
                <h4 className="font-label-caps text-label-caps text-on-surface uppercase">FABRICACIÓN</h4>
                <p className="font-code-sm text-code-sm text-on-surface-variant mt-1">Ejecución del trabajo</p>
              </div>
            </div>

            {/* Step 5 */}
            <div className="relative z-10 flex flex-row md:flex-col items-center group">
              <div className="w-12 h-12 rounded-full bg-surface-container-high text-primary-container flex items-center justify-center font-headline-md font-bold text-lg border-4 border-outline group-hover:border-primary-container transition-colors">
                05
              </div>
              <div className="ml-6 md:ml-0 md:mt-4 md:text-center">
                <h4 className="font-label-caps text-label-caps text-on-surface uppercase">CONTROL</h4>
                <p className="font-code-sm text-code-sm text-on-surface-variant mt-1">Revisión de calidad</p>
              </div>
            </div>

            {/* Step 6 */}
            <div className="relative z-10 flex flex-row md:flex-col items-center group">
              <div className="w-12 h-12 rounded-full bg-surface-container-high text-primary-container flex items-center justify-center font-headline-md font-bold text-lg border-4 border-outline group-hover:border-primary-container transition-colors">
                06
              </div>
              <div className="ml-6 md:ml-0 md:mt-4 md:text-center">
                <h4 className="font-label-caps text-label-caps text-on-surface uppercase">ENTREGA</h4>
                <p className="font-code-sm text-code-sm text-on-surface-variant mt-1">Entrega del trabajo terminado</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 9. TRABAJOS REALIZADOS */}
      <section className="w-full bg-background py-20 border-b border-outline" id="trabajos">
        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
          <div className="flex flex-col md:flex-row md:justify-between md:items-end mb-12 border-l-4 border-primary-container pl-4">
            <div>
              <h3 className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase mb-2">GALERÍA</h3>
              <h2 className="font-headline-lg text-headline-lg-mobile md:text-headline-lg font-bold text-on-surface uppercase">
                TRABAJOS REALIZADOS
              </h2>
            </div>
            <div className="mt-6 md:mt-0">
              <a
                className="inline-flex items-center justify-center px-4 py-2 bg-primary-container text-on-primary-container font-label-caps text-label-caps hover:bg-primary-fixed-dim transition-colors"
                href="#cotizacion"
                onClick={() => setActiveNav('cotizacion')}
              >
                SOLICITAR COTIZACIÓN
              </a>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 01 - TORNO */}
            <div className="relative group overflow-hidden sharp-border">
              <img
                alt="Torno industrial"
                className="w-full h-72 object-cover grayscale group-hover:grayscale-0 transition-all duration-500 scale-100 group-hover:scale-105"
                src={tornoGalleryImg}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent opacity-80"></div>
              <div className="absolute bottom-4 left-4">
                <h4 className="font-headline-md text-headline-md text-on-surface uppercase font-bold">
                  TORNO
                </h4>
              </div>
            </div>

            {/* 02 - FRESADO */}
            <div className="relative group overflow-hidden sharp-border">
              <img
                alt="Fresado industrial"
                className="w-full h-72 object-cover grayscale group-hover:grayscale-0 transition-all duration-500 scale-100 group-hover:scale-105"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuBGbni7SxU6HfhLwtUbc9PiI9SwSC5HnczCuf96vGHrsaNsvL8-ll_JZCS-jBVrau46yHhSCTFOeQY26blZzoSlih7eMKzcoJjVpol4eexW0Ks4CqrxITmxPGdaUGQKxstx6KkcA9XfXvSbfkIZNvAwihvCPSynh0TuI-3gGZtu7Ylt0qVGXDckO5msKreqr9wCZrzdaLsxAtE9gD3pPaJb8wPPRihJNS4ULPBtFPMtfjUr24VEXY5n"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent opacity-80"></div>
              <div className="absolute bottom-4 left-4">
                <h4 className="font-headline-md text-headline-md text-on-surface uppercase font-bold">
                  FRESADO
                </h4>
              </div>
            </div>

            {/* 03 - FABRICACIÓN */}
            <div className="relative group overflow-hidden sharp-border">
              <img
                alt="Fabricación de piezas"
                className="w-full h-72 object-cover grayscale group-hover:grayscale-0 transition-all duration-500 scale-100 group-hover:scale-105"
                src={fabricacionGalleryImg}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent opacity-80"></div>
              <div className="absolute bottom-4 left-4">
                <h4 className="font-headline-md text-headline-md text-on-surface uppercase font-bold">
                  FABRICACIÓN
                </h4>
              </div>
            </div>

            {/* 04 - REPARACIÓN */}
            <div className="relative group overflow-hidden sharp-border">
              <img
                alt="Reparación"
                className="w-full h-72 object-cover grayscale group-hover:grayscale-0 transition-all duration-500 scale-100 group-hover:scale-105"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuCRCedTnyrRhfyXwCd0psVMyBFX20Ka8yTV4DaHIY6Jn_a7LF4C7GkI2GUyQwL_V9FT3Ib51efRwZcOk-Gf11HWzjV3ac6jXvGCdCshatdKtMEv6Jx1wTv__-nW4L0PK6z0PwgWPJKivX-JHbdShSVnFeP_J-5-NF6vlQohmNjkipiXehYt9MUC1wQpwBFQOujw0a5dRrJ6C4tHbvh300WDSgVffaAoDxozsHmEZUEwElVIC7jwlDk0"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent opacity-80"></div>
              <div className="absolute bottom-4 left-4">
                <h4 className="font-headline-md text-headline-md text-on-surface uppercase font-bold">
                  REPARACIÓN
                </h4>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 10. ¿POR QUÉ NEXTPROJECT? */}
      <section className="w-full bg-surface py-20 border-b border-outline" id="por-que">
        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
          <div className="text-center mb-12">
            <h3 className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase mb-2">VENTAJAS</h3>
            <h2 className="font-headline-lg text-headline-lg-mobile md:text-headline-lg font-bold text-on-surface uppercase">
              ¿POR QUÉ NEXTPROJECT?
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-background sharp-border p-8 text-center border-t-4 border-t-primary-container">
              <span className="material-symbols-outlined text-primary-container text-4xl mb-4">straighten</span>
              <h4 className="font-headline-md text-headline-md text-on-surface uppercase mb-2">PRECISIÓN</h4>
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">En cada detalle</p>
            </div>
            <div className="bg-background sharp-border p-8 text-center border-t-4 border-t-primary-container">
              <span className="material-symbols-outlined text-primary-container text-4xl mb-4">verified</span>
              <h4 className="font-headline-md text-headline-md text-on-surface uppercase mb-2">CALIDAD</h4>
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">En cada trabajo</p>
            </div>
            <div className="bg-background sharp-border p-8 text-center border-t-4 border-t-primary-container">
              <span className="material-symbols-outlined text-primary-container text-4xl mb-4">handshake</span>
              <h4 className="font-headline-md text-headline-md text-on-surface uppercase mb-2">COMPROMISO</h4>
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">Con cada proyecto</p>
            </div>
            <div className="bg-background sharp-border p-8 text-center border-t-4 border-t-primary-container">
              <span className="material-symbols-outlined text-primary-container text-4xl mb-4">shield</span>
              <h4 className="font-headline-md text-headline-md text-on-surface uppercase mb-2">CONFIANZA</h4>
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">En nuestra relación con el cliente</p>
            </div>
          </div>
        </div>
      </section>

      {/* 11. SOLICITAR COTIZACIÓN */}
      <section className="w-full bg-background py-20 border-b border-outline" id="cotizacion">
        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop grid grid-cols-1 lg:grid-cols-2 gap-12">
          <div className="flex flex-col space-y-6">
            <div>
              <div className="border-l-4 border-primary-container pl-4 mb-4">
                <h3 className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase mb-1">
                  CONTACTO COMERCIAL
                </h3>
                <h2 className="font-headline-lg text-headline-lg-mobile md:text-headline-lg font-bold text-on-surface uppercase">
                  SOLICITAR COTIZACIÓN
                </h2>
              </div>
              <p className="font-body-md text-body-md text-on-surface-variant">
                Complete el formulario detallando sus requerimientos. Adjunte planos o fotografías de la pieza para una evaluación más precisa. Nuestro equipo técnico se pondrá en contacto a la brevedad.
              </p>
            </div>

            {/* ATENCIÓN INMEDIATA */}
            <div className="bg-surface sharp-border p-6 border-l-4 border-l-primary-container">
              <h4 className="font-label-caps text-label-caps text-on-surface uppercase mb-2 font-bold tracking-wider">
                ATENCIÓN INMEDIATA
              </h4>
              <p className="font-body-md text-body-md text-on-surface-variant mb-4">
                Para consultas urgentes, contáctenos directamente vía WhatsApp.
              </p>
              <a
                className="inline-flex items-center justify-center px-6 py-3 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-label-caps text-label-caps w-full md:w-auto cursor-pointer"
                href="https://wa.me/593939067666?text=Hola%20NEXTPROJECT,%20deseo%20solicitar%20una%20cotizaci%C3%B3n%20urgente%20para%20un%20trabajo%20de%20mecanizado."
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="material-symbols-outlined mr-2 text-[18px]">chat</span>
                COTIZAR POR WHATSAPP
              </a>
            </div>

            {/* ASISTENTE INTELIGENTE DE SOLICITUDES */}
            <div className="bg-surface sharp-border p-6 border-l-4 border-l-primary-container">
              <h4 className="font-label-caps text-label-caps text-on-surface uppercase mb-2 font-bold tracking-wider">
                ASISTENTE INTELIGENTE DE SOLICITUDES
              </h4>
              <p className="font-body-md text-body-md text-on-surface-variant mb-4">
                ¿No está seguro de cómo describir su requerimiento? Nuestro asistente puede analizar la información proporcionada y ayudar a identificar los datos técnicos necesarios para la evaluación inicial.
              </p>
              <button
                type="button"
                onClick={() => setModalType('asistente_ia')}
                className="inline-flex items-center justify-center px-6 py-3 bg-primary-container text-on-primary-container hover:bg-primary-fixed-dim transition-colors font-label-caps text-label-caps w-full md:w-auto cursor-pointer"
              >
                <span className="material-symbols-outlined mr-2 text-[18px]">smart_toy</span>
                ABRIR ASISTENTE DE SOLICITUDES IA
              </button>
            </div>
          </div>

          <div className="bg-surface sharp-border p-8 relative">
            {formSubmitted ? (
              <div className="text-center py-12 space-y-4">
                <div className="w-16 h-16 bg-primary-container text-on-primary-container flex items-center justify-center mx-auto">
                  <span className="material-symbols-outlined text-4xl">check_circle</span>
                </div>
                <h3 className="font-headline-md text-headline-md text-on-surface uppercase">
                  SOLICITUD REGISTRADA CON ÉXITO
                </h3>
                <p className="font-body-md text-on-surface-variant max-w-md mx-auto">
                  Hemos recibido sus datos y especificaciones. Un especialista técnico revisará la información y se comunicará con usted a la brevedad.
                </p>
                <div className="pt-4 flex flex-col sm:flex-row justify-center gap-4">
                  <button
                    onClick={() => {
                      setFormSubmitted(false);
                      setFormData({
                        nombre: '',
                        empresa: '',
                        telefono: '',
                        email: '',
                        servicio: 'SELECCIONE UN SERVICIO',
                        descripcion: '',
                        cantidad: '',
                        fecha: '',
                      });
                      setPhotoFiles([]);
                      setPdfFiles([]);
                    }}
                    className="px-6 py-3 border border-outline text-on-surface font-label-caps text-label-caps hover:bg-surface-container-high transition-colors"
                  >
                    ENVIAR OTRA SOLICITUD
                  </button>
                  <a
                    href="https://wa.me/593939067666"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-6 py-3 bg-primary-container text-on-primary-container font-label-caps text-label-caps hover:bg-primary-fixed-dim transition-colors inline-flex items-center justify-center"
                  >
                    <span className="material-symbols-outlined mr-2 text-[18px]">chat</span>
                    CONTACTAR POR WHATSAPP
                  </a>
                </div>
              </div>
            ) : (
              <form className="space-y-6" onSubmit={handleFormSubmit}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
                      NOMBRE COMPLETO
                    </label>
                    <input
                      name="nombre"
                      value={formData.nombre}
                      onChange={handleInputChange}
                      required
                      className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
                      placeholder="Ej. Juan Pérez"
                      type="text"
                    />
                  </div>
                  <div>
                    <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
                      EMPRESA / CLIENTE
                    </label>
                    <input
                      name="empresa"
                      value={formData.empresa}
                      onChange={handleInputChange}
                      className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
                      placeholder="Nombre de la industria"
                      type="text"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
                      TELÉFONO / WHATSAPP
                    </label>
                    <input
                      name="telefono"
                      value={formData.telefono}
                      onChange={handleInputChange}
                      required
                      className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
                      placeholder="Ej. 099 999 9999"
                      type="tel"
                    />
                  </div>
                  <div>
                    <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
                      CORREO ELECTRÓNICO
                    </label>
                    <input
                      name="email"
                      value={formData.email}
                      onChange={handleInputChange}
                      required
                      className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
                      placeholder="correo@empresa.com"
                      type="email"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
                    TIPO DE SERVICIO
                  </label>
                  <select
                    name="servicio"
                    value={formData.servicio}
                    onChange={handleInputChange}
                    className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none cursor-pointer"
                  >
                    <option value="SELECCIONE UN SERVICIO">SELECCIONE UN SERVICIO</option>
                    <option value="TORNO INDUSTRIAL">TORNO INDUSTRIAL</option>
                    <option value="FRESADO INDUSTRIAL">FRESADO INDUSTRIAL</option>
                    <option value="FABRICACIÓN DE PIEZA NUEVA">FABRICACIÓN DE PIEZA NUEVA</option>
                    <option value="REPARACIÓN / RECUPERACIÓN">REPARACIÓN / RECUPERACIÓN</option>
                    <option value="OTRO">OTRO</option>
                  </select>
                </div>

                <div>
                  <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
                    DESCRIPCIÓN DEL REQUERIMIENTO
                  </label>
                  <textarea
                    name="descripcion"
                    value={formData.descripcion}
                    onChange={handleInputChange}
                    required
                    className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md resize-none outline-none"
                    placeholder="Detalle material, medidas preliminares, tolerancias, etc."
                    rows={3}
                  ></textarea>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
                      CANTIDAD ESTIMADA
                    </label>
                    <input
                      name="cantidad"
                      value={formData.cantidad}
                      onChange={handleInputChange}
                      className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
                      placeholder="Ej. 10 piezas"
                      type="number"
                      min="1"
                    />
                  </div>
                  <div>
                    <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
                      FECHA REQUERIDA (OPCIONAL)
                    </label>
                    <input
                      name="fecha"
                      value={formData.fecha}
                      onChange={handleInputChange}
                      className="w-full bg-background border-0 border-b border-outline text-on-surface-variant px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md [color-scheme:dark] outline-none"
                      type="date"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border border-outline border-dashed p-4 text-center bg-background">
                    <span className="material-symbols-outlined text-on-surface-variant text-3xl mb-2">add_a_photo</span>
                    <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
                      {photoFiles.length > 0 ? `${photoFiles.length} FOTO(S) SELECCIONADA(S)` : 'ADJUNTAR FOTOGRAFÍAS'}
                    </p>
                    <input
                      ref={photoInputRef}
                      className="hidden"
                      id="photo-upload"
                      type="file"
                      multiple
                      accept="image/*"
                      onChange={handlePhotoUpload}
                    />
                    <label
                      className="cursor-pointer inline-flex items-center justify-center px-4 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-label-caps text-label-caps text-[10px]"
                      htmlFor="photo-upload"
                    >
                      {photoFiles.length > 0 ? 'CAMBIAR ARCHIVOS' : 'SELECCIONAR ARCHIVOS'}
                    </label>
                  </div>

                  <div className="border border-outline border-dashed p-4 text-center bg-background">
                    <span className="material-symbols-outlined text-on-surface-variant text-3xl mb-2">picture_as_pdf</span>
                    <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
                      {pdfFiles.length > 0 ? `${pdfFiles.length} ARCHIVO(S) PDF` : 'ADJUNTAR PLANO / PDF'}
                    </p>
                    <input
                      ref={pdfInputRef}
                      className="hidden"
                      id="pdf-upload"
                      type="file"
                      multiple
                      accept=".pdf"
                      onChange={handlePdfUpload}
                    />
                    <label
                      className="cursor-pointer inline-flex items-center justify-center px-4 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-label-caps text-label-caps text-[10px]"
                      htmlFor="pdf-upload"
                    >
                      {pdfFiles.length > 0 ? 'CAMBIAR ARCHIVOS' : 'SELECCIONAR ARCHIVOS'}
                    </label>
                  </div>
                </div>

                <p className="font-code-sm text-[11px] text-on-surface-variant uppercase mt-2 text-center">
                  Formatos aceptados: JPG, PNG, PDF. Se permite selección múltiple.
                </p>

                <button
                  disabled={isSubmitting}
                  className="w-full inline-flex items-center justify-center px-6 py-4 bg-primary-container text-on-primary-container font-label-caps text-label-caps hover:bg-primary-fixed-dim transition-colors mt-4 cursor-pointer disabled:opacity-50"
                  type="submit"
                >
                  {isSubmitting ? 'PROCESANDO SOLICITUD...' : 'ENVIAR SOLICITUD DE COTIZACIÓN'}
                  <span className="material-symbols-outlined ml-2 text-[18px]">send</span>
                </button>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* 12. CONTACTO */}
      <section className="w-full bg-surface py-20" id="contacto">
        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="border-l-4 border-primary-container pl-4 mb-8">
              <h3 className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase mb-2">
                UBICACIÓN Y DATOS
              </h3>
              <h2 className="font-headline-lg text-headline-lg-mobile md:text-headline-lg font-bold text-on-surface uppercase">
                CONTACTO
              </h2>
            </div>
            <div className="space-y-6 mt-8">
              <div className="flex items-start">
                <span className="material-symbols-outlined text-primary-container mr-4 text-[24px]">location_on</span>
                <div>
                  <h4 className="font-label-caps text-label-caps text-on-surface uppercase mb-1">UBICACIÓN</h4>
                  <p className="font-body-md text-body-md text-on-surface-variant">Shushufindi – Sucumbíos – Ecuador</p>
                </div>
              </div>
              <div className="flex items-start">
                <span className="material-symbols-outlined text-primary-container mr-4 text-[24px]">phone</span>
                <div>
                  <h4 className="font-label-caps text-label-caps text-on-surface uppercase mb-1">TELÉFONO / WHATSAPP</h4>
                  <a
                    href="https://wa.me/593939067666"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-body-md text-body-md text-on-surface-variant hover:text-primary transition-colors"
                  >
                    093 906 7666
                  </a>
                </div>
              </div>
              <div className="flex items-start">
                <span className="material-symbols-outlined text-primary-container mr-4 text-[24px]">email</span>
                <div>
                  <h4 className="font-label-caps text-label-caps text-on-surface uppercase mb-1">CORREO ELECTRÓNICO</h4>
                  <a
                    href="mailto:nextproject.mecanizado@gmail.com"
                    className="font-body-md text-body-md text-on-surface-variant hover:text-primary transition-colors"
                  >
                    nextproject.mecanizado@gmail.com
                  </a>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-background sharp-border h-80 flex flex-col items-center justify-center p-8 relative overflow-hidden group text-center">
            <div className="absolute inset-0 bg-surface-container-high opacity-50 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4=')]"></div>
            <span className="material-symbols-outlined text-primary-container text-5xl mb-3 relative z-10 group-hover:scale-110 transition-transform">
              location_on
            </span>
            <h4 className="font-headline-md text-headline-md text-on-surface uppercase mb-2 relative z-10 font-bold">
              MAPA DE UBICACIÓN
            </h4>
            <p className="font-body-md text-body-md text-on-surface-variant mb-6 relative z-10">
              Shushufindi, Sucumbíos, Ecuador
            </p>
            <a
              className="relative z-10 inline-flex items-center justify-center px-6 py-3 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-label-caps text-label-caps cursor-pointer"
              href="https://www.google.com/maps/search/?api=1&query=Shushufindi+Sucumbios+Ecuador"
              target="_blank"
              rel="noopener noreferrer"
            >
              VER EN GOOGLE MAPS
              <span className="material-symbols-outlined ml-2 text-[18px]">open_in_new</span>
            </a>
          </div>
        </div>
      </section>

      {/* 13. FOOTER (Shared Component Exact Implementation) */}
      <footer className="w-full bg-[#0A0A0A] border-t-4 border-primary hazard-border-top">
        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-12 grid grid-cols-1 md:grid-cols-3 gap-gutter">
          {/* Brand/Logo Col */}
          <div className="flex flex-col space-y-4">
            <div className="font-headline-md text-headline-md text-primary font-black uppercase tracking-tighter">
              <span>NEXT</span>
              <span className="text-primary-container">PROJECT</span>
            </div>
            <p className="font-code-sm text-code-sm text-on-surface-variant max-w-xs mt-2">
              Centro de mecanizado industrial de precisión. Soluciones técnicas para maquinaria y equipos pesados.
            </p>
          </div>

          {/* Links Col */}
          <div className="flex flex-col space-y-2">
            <h4 className="font-label-caps text-label-caps text-on-surface mb-2 border-b border-outline inline-block w-max pb-1">
              ENLACES
            </h4>
            <button
              onClick={() => setModalType('terminos')}
              className="font-code-sm text-code-sm text-on-surface-variant hover:text-primary underline transition-colors w-max text-left cursor-pointer"
            >
              TÉRMINOS DE SERVICIO
            </button>
            <button
              onClick={() => setModalType('privacidad')}
              className="font-code-sm text-code-sm text-on-surface-variant hover:text-primary underline transition-colors w-max text-left cursor-pointer"
            >
              POLÍTICA DE PRIVACIDAD
            </button>
          </div>

          {/* Copyright / Contact Info Col */}
          <div className="flex flex-col space-y-2 md:items-end md:text-right">
            <h4 className="font-label-caps text-label-caps text-on-surface mb-2 border-b border-outline inline-block w-max pb-1">
              LEGAL
            </h4>
            <span className="font-code-sm text-code-sm text-primary">
              © 2026 NEXTPROJECT CENTRO DE MECANIZADO INDUSTRIAL. TODOS LOS DERECHOS RESERVADOS.
            </span>
            <div className="mt-4 flex items-center space-x-2 text-on-surface-variant">
              <span className="material-symbols-outlined text-[16px]">location_on</span>
              <span className="font-code-sm text-code-sm uppercase">SHUSHUFINDI, SUCUMBÍOS, ECUADOR</span>
            </div>
          </div>
        </div>
      </footer>

      {/* MODAL DIALOGS (Terms / Privacy / Gallery) */}
      {modalType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="bg-surface sharp-border border-t-4 border-t-primary-container max-w-2xl w-full p-6 md:p-8 max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-4 border-b border-outline mb-6">
              <h3 className="font-headline-md text-headline-md uppercase text-on-surface">
                {modalType === 'terminos' && 'TÉRMINOS DE SERVICIO'}
                {modalType === 'privacidad' && 'POLÍTICA DE PRIVACIDAD'}
                {modalType === 'galeria' && 'GALERÍA TÉCNICA DE TRABAJOS'}
                {modalType === 'asistente_ia' && 'ASISTENTE INTELIGENTE DE SOLICITUDES'}
              </h3>
              <button
                onClick={() => {
                  setModalType(null);
                  setAiTechnicalSpec(null);
                }}
                className="text-on-surface-variant hover:text-on-surface p-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-2xl">close</span>
              </button>
            </div>

            {modalType === 'asistente_ia' && (
              <div className="space-y-6">
                <p className="font-body-md text-sm text-on-surface-variant">
                  Escriba en sus propias palabras la pieza, falla o trabajo que necesita. El asistente estructurará los datos técnicos clave para la cotización inicial.
                </p>

                <div className="space-y-2">
                  <label className="block font-code-sm text-xs text-on-surface-variant uppercase">
                    Describa su requerimiento o pieza
                  </label>
                  <textarea
                    rows={3}
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="Ejemplo: Necesito reparar un eje de 2 pulgadas que tiene desgaste donde asienta el rodamiento, o fabricar 4 bujes de bronce para una máquina..."
                    className="w-full bg-background border border-outline p-3 text-on-surface text-sm focus:border-primary-container focus:outline-hidden font-body-md"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className="font-code-sm text-[11px] text-on-surface-variant uppercase self-center mr-1">
                    Sugerencias:
                  </span>
                  {[
                    'Eje con desgaste en rodamiento',
                    'Bujes de bronce fosforado a medida',
                    'Fresado de chavetero en eje',
                    'Fabricación de brida de acople',
                  ].map((sug, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setAiPrompt(sug)}
                      className="px-2.5 py-1 bg-surface-container-high hover:bg-outline border border-outline/60 text-on-surface text-xs font-code-sm transition-colors cursor-pointer"
                    >
                      {sug}
                    </button>
                  ))}
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    disabled={!aiPrompt.trim() || aiAnalyzing}
                    onClick={() => {
                      setAiAnalyzing(true);
                      setTimeout(() => {
                        setAiAnalyzing(false);
                        const promptLower = aiPrompt.toLowerCase();
                        let servicioDetectado = 'MECANIZADO EN TORNO CONVENCIONAL';
                        let material = 'Acero SAE 1045 / 4140';
                        let proceso = 'Torneado cilíndrico de precisión y ajuste';

                        if (promptLower.includes('buje') || promptLower.includes('bronce')) {
                          servicioDetectado = 'FABRICACIÓN DE PIEZAS Y COMPONENTES';
                          material = 'Bronce Fosforado / SAE 660';
                          proceso = 'Torneado interior/exterior y ranurado de lubricación';
                        } else if (promptLower.includes('fresad') || promptLower.includes('chavetero') || promptLower.includes('cuñero')) {
                          servicioDetectado = 'FRESADO INDUSTRIAL';
                          material = 'Acero de transmisión';
                          proceso = 'Fresado de chaveteros bajo norma DIN 6885';
                        } else if (promptLower.includes('repar') || promptLower.includes('desgaste') || promptLower.includes('relleno')) {
                          servicioDetectado = 'REPARACIÓN Y RECUPERACIÓN DE PIEZAS';
                          material = 'Acero base con aporte de soldadura especial';
                          proceso = 'Relleno por soldadura, desbaste y rectificado a medida original';
                        }

                        const spec = `REQUERIMIENTO: ${aiPrompt.trim()}\n• SERVICIO IDENTIFICADO: ${servicioDetectado}\n• MATERIAL BASE RECOMENDADO: ${material}\n• PROCESO TÉCNICO: ${proceso}\n• DATOS REQUERIDOS: Diámetro exterior, diámetro interior, longitud total, tolerancia y muestra/plano.`;
                        setAiTechnicalSpec(spec);
                      }, 400);
                    }}
                    className="w-full sm:w-auto px-6 py-2.5 bg-primary-container text-on-primary-container font-label-caps text-xs uppercase hover:bg-primary-fixed-dim transition-colors inline-flex items-center justify-center cursor-pointer disabled:opacity-50"
                  >
                    {aiAnalyzing ? (
                      <>
                        <span className="material-symbols-outlined animate-spin mr-2 text-[16px]">sync</span>
                        ANALIZANDO...
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined mr-2 text-[16px]">search_check</span>
                        ESTRUCTURAR ESPECIFICACIÓN TÉCNICA
                      </>
                    )}
                  </button>
                </div>

                {aiTechnicalSpec && (
                  <div className="bg-background sharp-border p-4 border-l-4 border-l-primary-container space-y-3">
                    <h5 className="font-label-caps text-xs text-primary-container uppercase font-bold">
                      ESPECIFICACIÓN TÉCNICA SUGERIDA
                    </h5>
                    <pre className="font-code-sm text-xs text-on-surface whitespace-pre-wrap leading-relaxed">
                      {aiTechnicalSpec}
                    </pre>
                    <div className="pt-2 flex flex-col sm:flex-row gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setFormData((prev) => ({
                            ...prev,
                            descripcion: (prev.descripcion ? prev.descripcion + '\n\n' : '') + aiTechnicalSpec,
                          }));
                          setModalType(null);
                          setAiTechnicalSpec(null);
                          const el = document.getElementById('cotizacion');
                          if (el) el.scrollIntoView({ behavior: 'smooth' });
                        }}
                        className="px-4 py-2 bg-primary-container text-on-primary-container font-label-caps text-xs uppercase hover:bg-primary-fixed-dim transition-colors cursor-pointer"
                      >
                        APLICAR AL FORMULARIO DE COTIZACIÓN
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {modalType === 'terminos' && (
              <div className="space-y-4 font-body-md text-on-surface-variant text-sm">
                <p>
                  <strong>1. Condiciones Generales:</strong> Todos los servicios prestados por NEXTPROJECT se ejecutan conforme a los planos, especificaciones y muestras entregadas por el cliente.
                </p>
                <p>
                  <strong>2. Tolerancias y Especificaciones:</strong> Los trabajos de mecanizado convencional cumplen con las normas técnicas y tolerancias dimensionales acordadas previamente en la cotización comercial.
                </p>
                <p>
                  <strong>3. Plazos de Entrega:</strong> Los tiempos de fabricación y entrega se determinan según la complejidad del proyecto y disponibilidad de materiales, contados a partir de la confirmación formal del requerimiento.
                </p>
                <p>
                  <strong>4. Garantía de Calidad:</strong> Todo componente es verificado mediante control dimensional riguroso antes de su entrega.
                </p>
              </div>
            )}

            {modalType === 'privacidad' && (
              <div className="space-y-4 font-body-md text-on-surface-variant text-sm">
                <p>
                  <strong>1. Tratamiento de Datos:</strong> Los datos proporcionados en los formularios de cotización y contacto son utilizados exclusivamente para la elaboración de propuestas técnicas y comunicación comercial directa.
                </p>
                <p>
                  <strong>2. Confidencialidad Técnica:</strong> Los planos, especificaciones de diseño, modelos y fotografías suministradas por nuestros clientes son tratados con estricta confidencialidad industrial.
                </p>
                <p>
                  <strong>3. Protección:</strong> No compartimos ni comercializamos información con terceros bajo ninguna circunstancia.
                </p>
              </div>
            )}

            {modalType === 'galeria' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sharp-border p-2 bg-background">
                    <img
                      src={tornoGalleryImg}
                      alt="Torno convencional de precisión"
                      className="w-full h-44 object-cover"
                    />
                    <p className="font-label-caps text-xs text-on-surface mt-2 uppercase">Mecanizado en Torno - Ejes y Bujes</p>
                  </div>
                  <div className="sharp-border p-2 bg-background">
                    <img
                      src="https://lh3.googleusercontent.com/aida-public/AB6AXuBGbni7SxU6HfhLwtUbc9PiI9SwSC5HnczCuf96vGHrsaNsvL8-ll_JZCS-jBVrau46yHhSCTFOeQY26blZzoSlih7eMKzcoJjVpol4eexW0Ks4CqrxITmxPGdaUGQKxstx6KkcA9XfXvSbfkIZNvAwihvCPSynh0TuI-3gGZtu7Ylt0qVGXDckO5msKreqr9wCZrzdaLsxAtE9gD3pPaJb8wPPRihJNS4ULPBtFPMtfjUr24VEXY5n"
                      alt="Fresado industrial de piezas"
                      className="w-full h-44 object-cover"
                    />
                    <p className="font-label-caps text-xs text-on-surface mt-2 uppercase">Fresado de Planos y Ranurados</p>
                  </div>
                  <div className="sharp-border p-2 bg-background">
                    <img
                      src={fabricacionGalleryImg}
                      alt="Fabricación de componentes a medida"
                      className="w-full h-44 object-cover"
                    />
                    <p className="font-label-caps text-xs text-on-surface mt-2 uppercase">Fabricación Bajo Plano Técnico</p>
                  </div>
                  <div className="sharp-border p-2 bg-background">
                    <img
                      src="https://lh3.googleusercontent.com/aida-public/AB6AXuCRCedTnyrRhfyXwCd0psVMyBFX20Ka8yTV4DaHIY6Jn_a7LF4C7GkI2GUyQwL_V9FT3Ib51efRwZcOk-Gf11HWzjV3ac6jXvGCdCshatdKtMEv6Jx1wTv__-nW4L0PK6z0PwgWPJKivX-JHbdShSVnFeP_J-5-NF6vlQohmNjkipiXehYt9MUC1wQpwBFQOujw0a5dRrJ6C4tHbvh300WDSgVffaAoDxozsHmEZUEwElVIC7jwlDk0"
                      alt="Recuperación y rectificación de piezas"
                      className="w-full h-44 object-cover"
                    />
                    <p className="font-label-caps text-xs text-on-surface mt-2 uppercase">Recuperación y Ajuste Dimensional</p>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-6 pt-4 border-t border-outline flex justify-end">
              <button
                onClick={() => setModalType(null)}
                className="px-6 py-2 bg-primary-container text-on-primary-container font-label-caps text-label-caps hover:bg-primary-fixed-dim transition-colors cursor-pointer"
              >
                CERRAR
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
