/**
 * PLAN BÁSICO v4 - Híbrido
 * Funciona SIN modificar código existente + protecciones mejoradas
 * Oculta: Inventario, Historial, Laboratorios, WhatsApp, Objetivos
 * Visible: Agenda, Caja, Productividad, Facturación
 */

(function() {
  'use strict';

  // ====== CONFIGURACIÓN ======
  const PLAN_CONFIG = {
    name: 'basic',
    hiddenModules: ['inventario', 'historial', 'laboratorios', 'whatsapp', 'objetivos', 'dashboard-global'],
    debug: true // Cambiar a false para producción
  };

  // ====== UTILIDADES ======
  function log(message, type = 'info') {
    if (!PLAN_CONFIG.debug) return;
    const prefix = '[Plan Básico v4]';
    if (type === 'error') console.error(prefix, message);
    else console.log(prefix, message);
  }

  function getText(element) {
    return (element?.textContent || element?.innerText || '').trim().toLowerCase();
  }

  function isProtectedElement(element) {
    if (!element) return true;
    
    // Elementos críticos que NUNCA se deben ocultar
    const criticalElements = ['#root', 'body', 'html'];
    const tagName = element.tagName?.toLowerCase();
    const id = element.id;
    
    if (criticalElements.includes(`#${id}`) || criticalElements.includes(tagName)) {
      return true;
    }
    
    // Proteger si es el elemento root directamente
    if (element.id === 'root') return true;
    if (element === document.body || element === document.documentElement) return true;
    
    // Proteger si es hijo directo de root sin hermanos
    const rootElement = document.getElementById('root');
    if (rootElement && element.parentElement === rootElement && rootElement.children.length === 1) {
      return true;
    }
    
    return false;
  }

  function safeHide(element, reason = '') {
    if (!element || isProtectedElement(element)) {
      if (reason && PLAN_CONFIG.debug) {
        log(`Protegido: ${reason}`, 'info');
      }
      return false;
    }
    
    try {
      element.style.display = 'none';
      element.setAttribute('data-hidden-by-plan', PLAN_CONFIG.name);
      
      if (reason && PLAN_CONFIG.debug) {
        log(`✓ Ocultado: ${reason}`);
      }
      return true;
    } catch (error) {
      log(`Error ocultando elemento: ${error.message}`, 'error');
      return false;
    }
  }

  function findClickableParent(element, maxLevels = 3) {
    let current = element;
    let level = 0;
    
    while (current && level < maxLevels) {
      const tagName = current.tagName?.toLowerCase();
      const role = current.getAttribute('role');
      const className = current.className || '';
      
      // Verificar si es un elemento clickeable
      if (tagName === 'a' || 
          tagName === 'button' ||
          role === 'tab' ||
          role === 'button' ||
          current.hasAttribute('data-nav') ||
          className.includes('cursor-pointer') ||
          className.includes('btn') ||
          className.includes('tab')) {
        return current;
      }
      
      current = current.parentElement;
      level++;
    }
    
    return element;
  }

  // ====== MÉTODOS DE OCULTACIÓN ======
  
  // 1. Remover elementos flotantes específicos
  function removeFloatingElements() {
    const floatingIds = [
      'objetivos-floating-root-v3',
      'objetivos-floating',
      'floating-objetivos'
    ];
    
    floatingIds.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        element.remove();
        log(`Removido elemento flotante: ${id}`);
      }
    });
  }

  // 2. Ocultar por texto en navegación
  function hideNavigationByText() {
    const moduleTexts = {
      inventario: ['inventario', 'inventory'],
      historial: ['historial', 'history', 'historia clínica'],
      laboratorios: ['laboratorios', 'laboratorio', 'labs', 'lab'],
      whatsapp: ['whatsapp', 'whats app', 'wa'],
      objetivos: ['objetivos', 'objetivo', 'goals', 'metas']
    };

    // Buscar en header y navegación principal
    const navigationSelectors = [
      'header button',
      'header a',
      'nav button', 
      'nav a',
      '[data-nav]',
      '.navigation button',
      '.navigation a'
    ];

    navigationSelectors.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(element => {
          const text = getText(element);
          
          Object.entries(moduleTexts).forEach(([module, texts]) => {
            if (PLAN_CONFIG.hiddenModules.includes(module)) {
              texts.forEach(searchText => {
                if (text.includes(searchText)) {
                  const target = findClickableParent(element);
                  safeHide(target, `Header/Nav ${module}: "${searchText}"`);
                }
              });
            }
          });
        });
      } catch (error) {
        // Ignorar errores de selector
      }
    });
  }

  // 3. Ocultar tabs/pestañas
  function hideTabs() {
    const tabSelectors = [
      '[role="tab"]',
      '.tabs button',
      '.tabs a',
      '.tab-item',
      '[data-tab]'
    ];

    const tabTexts = {
      laboratorios: ['laboratorios', 'laboratorio', 'labs'],
      whatsapp: ['whatsapp', 'whats app'],
      inventario: ['inventario', 'inventory'],
      historial: ['historial', 'history']
    };

    tabSelectors.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(element => {
          const text = getText(element);
          
          Object.entries(tabTexts).forEach(([module, texts]) => {
            if (PLAN_CONFIG.hiddenModules.includes(module)) {
              texts.forEach(searchText => {
                if (text.includes(searchText)) {
                  safeHide(element, `Tab ${module}: "${searchText}"`);
                }
              });
            }
          });
        });
      } catch (error) {
        // Ignorar errores de selector
      }
    });
  }

  // 4. Ocultar paneles específicos de inventario
  function hideInventoryPanels() {
    if (!PLAN_CONFIG.hiddenModules.includes('inventario')) return;

    const inventoryTabTexts = [
      'equipo básico',
      'material resurtible', 
      'fórmulas de uso',
      'historial compras',
      'análisis',
      'equipment',
      'materials',
      'supplies'
    ];

    // Buscar tabs específicos de inventario
    inventoryTabTexts.forEach(tabText => {
      document.querySelectorAll('button, a, [role="tab"], span').forEach(element => {
        const text = getText(element);
        
        if (text.includes(tabText)) {
          // Buscar el contenedor del panel
          let container = element;
          for (let i = 0; i < 5 && container.parentElement; i++) {
            container = container.parentElement;
            
            // Si encontramos un contenedor con múltiples tabs, ocultarlo
            if (container.children.length > 1 && 
                container.querySelector('[role="tab"], .tab, button')) {
              safeHide(container, `Panel de inventario: ${tabText}`);
              break;
            }
          }
        }
      });
    });
  }

  // 5. Ocultar botones flotantes
  function hideFloatingButtons() {
    // Buscar botones flotantes de objetivos
    const floatingSelectors = [
      '[style*="fixed"]',
      '[style*="absolute"]',
      '.floating',
      '.fixed'
    ];

    floatingSelectors.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(element => {
          const text = getText(element);
          
          if (text.includes('objetivos') || text.includes('goals')) {
            safeHide(element, `Botón flotante: objetivos`);
          }
        });
      } catch (error) {
        // Ignorar errores
      }
    });
  }

  // ====== FUNCIÓN PRINCIPAL ======
  function applyBasicPlan() {
    const root = document.getElementById('root');
    
    // Verificar que la app esté cargada
    if (!root || root.children.length === 0) {
      return false;
    }

    try {
      log(`Aplicando Plan Básico v4...`);
      
      // 1. Remover elementos flotantes
      removeFloatingElements();
      
      // 2. Ocultar navegación por texto
      hideNavigationByText();
      
      // 3. Ocultar tabs
      hideTabs();
      
      // 4. Ocultar paneles de inventario
      hideInventoryPanels();
      
      // 5. Ocultar botones flotantes
      hideFloatingButtons();
      
      log('✓ Plan Básico aplicado exitosamente');
      return true;
      
    } catch (error) {
      log(`Error aplicando plan: ${error.message}`, 'error');
      return false;
    }
  }

  // ====== INICIALIZACIÓN ======
  function initialize() {
    log('Iniciando Plan Básico v4...');
    
    // Aplicar cuando el DOM esté listo
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(applyBasicPlan, 500);
      });
    } else {
      setTimeout(applyBasicPlan, 500);
    }

    // Reaplicar para SPAs que cargan dinámicamente
    setTimeout(applyBasicPlan, 1500);
    setTimeout(applyBasicPlan, 3000);

    // Observer para reactividad
    const observer = new MutationObserver((mutations) => {
      let shouldReapply = false;
      
      mutations.forEach(mutation => {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1) { // Element node
              const tagName = node.tagName?.toLowerCase();
              const className = node.className || '';
              
              // Detectar si se agregaron elementos de navegación
              if (tagName === 'nav' || 
                  tagName === 'header' ||
                  className.includes('tab') ||
                  className.includes('nav') ||
                  node.querySelector && (
                    node.querySelector('button') || 
                    node.querySelector('a') ||
                    node.querySelector('[role="tab"]')
                  )) {
                shouldReapply = true;
              }
            }
          });
        }
      });
      
      if (shouldReapply) {
        setTimeout(applyBasicPlan, 300);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // API para debug
    window.PlanBasico = {
      reapply: applyBasicPlan,
      config: PLAN_CONFIG,
      debug: {
        enable: () => { PLAN_CONFIG.debug = true; },
        disable: () => { PLAN_CONFIG.debug = false; }
      }
    };
  }

  // Inicializar
  initialize();

})();