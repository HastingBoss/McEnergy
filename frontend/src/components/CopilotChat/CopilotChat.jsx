import { useState, useRef, useEffect } from 'react';
import { Bot, X, Send, Sparkles, RefreshCw, ChevronRight } from 'lucide-react';
import { askCopilot } from '../../services/aiService';
import { useStore } from '../../context/StoreContext';

const QUICK_PROMPTS = [
  '¿Qué pasa si me olvidé de cargar un día?',
  'Cargué mal el valor del medidor, ¿cómo lo corrijo?',
  '¿Qué hago si el medidor fue reemplazado o reseteado?'
];

export default function CopilotChat() {
  const { stores, currentStore } = useStore();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: '¡Hola! Soy McEnergy ChatBot. ¿En qué puedo ayudarte con el monitoreo eléctrico, factores de multiplicación o procedimientos de guardia?'
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const handleSendMessage = async (textToSend) => {
    const query = (textToSend || inputText).trim();
    if (!query || isTyping) return;

    const userMsg = { role: 'user', text: query };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInputText('');
    setIsTyping(true);

    try {
      const historyPayload = updatedMessages.slice(-6).map((m) => ({
        role: m.role === 'user' ? 'user' : 'model',
        text: m.text
      }));

      const systemContext = {
        stores: stores || [],
        activeStore: currentStore ? { name: currentStore.name, code: currentStore.code, multiplier: currentStore.meter_multiplier } : null
      };

      const response = await askCopilot(query, historyPayload, systemContext);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: response.reply || 'No recibí respuesta del servicio.' }
      ]);
    } catch (err) {
      console.error('Error con McEnergy ChatBot:', err);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: 'Error de comunicación: ' + (err.message || 'No pude procesar la consulta.') }
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <>
      {/* Botón Flotante Activar Chat (ubicado por encima de la barra de navegación) */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          style={{
            position: 'fixed',
            bottom: 'calc(76px + env(safe-area-inset-bottom, 0px))',
            right: '16px',
            zIndex: 990,
            backgroundColor: '#27251F',
            color: '#FFC72C',
            border: '2px solid #FFC72C',
            borderRadius: '50px',
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            boxShadow: '0 6px 20px rgba(0, 0, 0, 0.75)',
            cursor: 'pointer',
            fontWeight: '800',
            fontSize: '0.86rem',
            transition: 'transform 0.2s ease',
            outline: 'none'
          }}
          className="hover:scale-105"
        >
          <Bot size={18} color="#FFC72C" />
          <span>ChatBot IA</span>
        </button>
      )}

      {/* Ventana de Chat (Posicionada arriba del Navbar inferior para no tapar pestañas) */}
      {isOpen && (
        <div style={{
          position: 'fixed',
          bottom: 'calc(76px + env(safe-area-inset-bottom, 0px))',
          right: '16px',
          left: '16px',
          maxWidth: '430px',
          margin: '0 auto',
          height: '510px',
          maxHeight: 'calc(100dvh - 100px)',
          backgroundColor: '#27251F',
          border: '2px solid #FFC72C',
          borderRadius: '18px',
          zIndex: 1050,
          boxShadow: '0 18px 40px rgba(0,0,0,0.92)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>
          {/* Header */}
          <div style={{
            backgroundColor: '#1D1D1D',
            padding: '12px 16px',
            borderBottom: '1px solid #3A3833',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                backgroundColor: 'rgba(255, 199, 44, 0.15)',
                padding: '6px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Bot size={20} color="#FFC72C" />
              </div>
              <div>
                <h4 style={{ margin: 0, fontSize: '0.92rem', fontWeight: '800', color: '#FFFFFF' }}>
                  McEnergy ChatBot
                </h4>
                <span style={{ fontSize: '0.7rem', color: '#4ade80', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '6px', height: '6px', backgroundColor: '#4ade80', borderRadius: '50%', display: 'inline-block' }} />
                  Gemini Flash AI Online
                </span>
              </div>
            </div>

            <button
              onClick={() => setIsOpen(false)}
              aria-label="Cerrar chat"
              style={{
                background: 'none',
                border: 'none',
                color: '#A0A0A0',
                cursor: 'pointer',
                padding: '6px',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <X size={20} />
            </button>
          </div>

          {/* Lista de Mensajes */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}>
            {messages.map((m, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                  gap: '8px'
                }}
              >
                {m.role === 'assistant' && (
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', backgroundColor: '#1D1D1D', border: '1px solid #FFC72C', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Bot size={14} color="#FFC72C" />
                  </div>
                )}

                <div style={{
                  maxWidth: '82%',
                  padding: '10px 14px',
                  borderRadius: m.role === 'user' ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                  backgroundColor: m.role === 'user' ? '#FFC72C' : '#1D1D1D',
                  color: m.role === 'user' ? '#121212' : '#FFFFFF',
                  fontWeight: m.role === 'user' ? '700' : '400',
                  fontSize: '0.85rem',
                  lineHeight: '1.45',
                  border: m.role === 'user' ? 'none' : '1px solid #3A3833',
                  whiteSpace: 'pre-wrap'
                }}>
                  {m.text}
                </div>
              </div>
            ))}

            {isTyping && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '26px', height: '26px', borderRadius: '50%', backgroundColor: '#1D1D1D', border: '1px solid #FFC72C', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Bot size={14} color="#FFC72C" />
                </div>
                <div style={{
                  backgroundColor: '#1D1D1D',
                  border: '1px solid #3A3833',
                  borderRadius: '12px',
                  padding: '8px 12px',
                  color: '#FFC72C',
                  fontSize: '0.78rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  <RefreshCw size={12} className="animate-spin" />
                  Escribiendo respuesta...
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Preguntas Frecuentes en Lista Vertical (Sin scroll lateral) */}
          {messages.length <= 2 && !isTyping && (
            <div style={{
              padding: '6px 14px 10px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              borderTop: '1px solid #2A2824',
              backgroundColor: '#1D1D1D'
            }}>
              <span style={{ fontSize: '0.68rem', color: '#888888', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '800' }}>
                Preguntas frecuentes:
              </span>
              {QUICK_PROMPTS.map((prompt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSendMessage(prompt)}
                  style={{
                    backgroundColor: '#27251F',
                    border: '1px solid #3A3833',
                    color: '#E0E0E0',
                    fontSize: '0.78rem',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    lineHeight: '1.3',
                    minHeight: '38px',
                    transition: 'all 0.15s ease'
                  }}
                  className="hover:border-mcd-yellow"
                >
                  <span style={{ flex: 1 }}>{prompt}</span>
                  <ChevronRight size={14} color="#FFC72C" style={{ flexShrink: 0, marginLeft: '6px' }} />
                </button>
              ))}
            </div>
          )}

          {/* Input Footer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            style={{
              padding: '10px 12px',
              backgroundColor: '#1D1D1D',
              borderTop: '1px solid #3A3833',
              display: 'flex',
              gap: '8px',
              flexShrink: 0
            }}
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={isTyping}
              placeholder="Preguntale algo a McEnergy ChatBot..."
              style={{
                flex: 1,
                backgroundColor: '#27251F',
                border: '1px solid #3A3833',
                borderRadius: '10px',
                padding: '8px 12px',
                fontSize: '0.85rem',
                color: '#FFFFFF',
                outline: 'none'
              }}
            />
            <button
              type="submit"
              disabled={isTyping || !inputText.trim()}
              className="btn-mcd-yellow"
              style={{
                padding: '0 12px',
                borderRadius: '10px',
                minHeight: '38px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: !inputText.trim() ? 'not-allowed' : 'pointer'
              }}
            >
              <Send size={15} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
