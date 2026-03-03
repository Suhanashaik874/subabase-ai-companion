import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Clock, ChevronRight, ChevronLeft, Check, Loader2, Video, VideoOff, Mic, MicOff, Send, MessageSquare, Camera, Timer, MicIcon, StopCircle } from 'lucide-react';
import { useQuestionTimer } from '@/hooks/useQuestionTimer';
import { useSpeechToText } from '@/hooks/useSpeechToText';
import { Button } from '@/components/ui/button';
import { Navbar } from '@/components/layout/Navbar';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import { Textarea } from '@/components/ui/textarea';

interface Question { id?: string; question_type: string; difficulty: string; question_text: string; expected_answer?: string; user_answer?: string; }

export default function HRInterview() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [interview, setInterview] = useState<any>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const timer = useQuestionTimer(0);
  const questionsRef = useRef<Question[]>([]);
  useEffect(() => { questionsRef.current = questions; }, [questions]);
  const answerRef = useRef('');
  useEffect(() => { answerRef.current = answer; }, [answer]);
  const currentIndexRef = useRef(0);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);

  const updateQuestionAnswer = useCallback((index: number, newAnswer: string) => {
    setQuestions(prev => { const updated = prev.map((q, i) => i === index ? { ...q, user_answer: newAnswer } : q); questionsRef.current = updated; return updated; });
  }, []);

  const handleVoiceTranscript = useCallback((text: string) => {
    setAnswer(prev => { const updated = prev ? prev + ' ' + text : text; updateQuestionAnswer(currentIndexRef.current, updated); return updated; });
  }, [updateQuestionAnswer]);

  const speech = useSpeechToText(handleVoiceTranscript);

  useEffect(() => { if (!authLoading && !user) navigate('/auth'); }, [user, authLoading, navigate]);
  useEffect(() => { if (user && id) fetchInterview(); }, [user, id]);
  useEffect(() => { return () => { if (stream) stream.getTracks().forEach(track => track.stop()); }; }, [stream]);
  useEffect(() => { if (videoRef.current && stream && isVideoOn) { videoRef.current.srcObject = stream; videoRef.current.play().catch(console.error); } }, [stream, isVideoOn]);

  const toggleVideo = async () => {
    if (isVideoOn) { stream?.getVideoTracks().forEach(t => t.stop()); setIsVideoOn(false); }
    else { try { const ms = await navigator.mediaDevices.getUserMedia({ video: true, audio: isMicOn }); if (stream) stream.getTracks().forEach(t => t.stop()); setStream(ms); setIsVideoOn(true); toast.success('Camera enabled'); } catch { toast.error('Could not access camera.'); } }
  };

  const toggleMic = async () => {
    if (isMicOn) { stream?.getAudioTracks().forEach(t => t.stop()); setIsMicOn(false); }
    else { try { if (isVideoOn && stream) { const as = await navigator.mediaDevices.getUserMedia({ audio: true }); as.getAudioTracks().forEach(t => stream.addTrack(t)); } else { setStream(await navigator.mediaDevices.getUserMedia({ audio: true })); } setIsMicOn(true); toast.success('Microphone enabled'); } catch { toast.error('Could not access microphone.'); } }
  };

  const fetchResumeContext = async () => {
    try {
      const { data: resumes } = await supabase.from('resumes').select('raw_text').eq('user_id', user?.id).order('uploaded_at', { ascending: false }).limit(1);
      const { data: skillsData } = await supabase.from('extracted_skills').select('skill_name, proficiency_level').eq('user_id', user?.id);
      return { resumeText: resumes?.[0]?.raw_text || '', skills: skillsData || [] };
    } catch { return { resumeText: '', skills: [] }; }
  };

  const fetchInterview = async () => {
    try {
      const { data: interviewData } = await supabase.from('interviews').select('*').eq('id', id).single();
      if (!interviewData) { navigate('/dashboard'); return; }
      setInterview(interviewData);
      const { data: existingQuestions } = await supabase.from('interview_questions').select('*').eq('interview_id', id);
      if (existingQuestions?.length) { setQuestions(existingQuestions); questionsRef.current = existingQuestions; if (existingQuestions[0].user_answer) setAnswer(existingQuestions[0].user_answer); }
      else { await generateQuestions(); }
    } catch (error) { console.error('Error:', error); toast.error('Failed to load interview.'); }
    finally { setLoading(false); }
  };

  const generateQuestions = async () => {
    setGenerating(true);
    try {
      const { resumeText, skills: userSkills } = await fetchResumeContext();
      const { data, error } = await supabase.functions.invoke('generate-questions', { body: { interviewType: 'hr', skills: userSkills, interviewId: id, difficulty: searchParams.get('difficulty') || 'medium', resumeText } });
      if (error) throw error;
      if (!data.questions?.length) throw new Error('No questions generated');
      const questionsToInsert = data.questions.map((q: Question) => ({ interview_id: id, question_type: q.question_type, difficulty: q.difficulty, question_text: q.question_text, expected_answer: q.expected_answer }));
      const { data: savedQuestions, error: insertError } = await supabase.from('interview_questions').insert(questionsToInsert).select();
      if (insertError) {
        const tempQuestions = data.questions.map((q: Question, idx: number) => ({ ...q, id: `temp-${idx}` }));
        setQuestions(tempQuestions); questionsRef.current = tempQuestions;
      } else if (savedQuestions?.length) { setQuestions(savedQuestions); questionsRef.current = savedQuestions; toast.success('Questions generated!'); }
    } catch (error) { console.error('Error:', error); toast.error('Failed to generate questions.'); }
    finally { setGenerating(false); }
  };

  const saveAnswerToDB = async (questionId: string | undefined, answerText: string) => {
    if (!questionId || questionId.startsWith('temp-')) return;
    try { await supabase.from('interview_questions').update({ user_answer: answerText }).eq('id', questionId); } catch {}
  };

  const saveAnswer = async () => { updateQuestionAnswer(currentIndex, answer); await saveAnswerToDB(questions[currentIndex]?.id, answer); };

  const nextQuestion = async () => {
    updateQuestionAnswer(currentIndex, answer); await saveAnswerToDB(questions[currentIndex]?.id, answer);
    if (currentIndex < questions.length - 1) { const next = currentIndex + 1; setCurrentIndex(next); timer.switchToQuestion(next); speech.stopListening(); speech.resetTranscript(); setAnswer(questionsRef.current[next]?.user_answer || ''); }
  };

  const prevQuestion = () => {
    updateQuestionAnswer(currentIndex, answer); saveAnswerToDB(questions[currentIndex]?.id, answer);
    if (currentIndex > 0) { const prev = currentIndex - 1; setCurrentIndex(prev); timer.switchToQuestion(prev); speech.stopListening(); speech.resetTranscript(); setAnswer(questionsRef.current[prev]?.user_answer || ''); }
  };

  const goToQuestion = async (idx: number) => {
    updateQuestionAnswer(currentIndex, answer); await saveAnswerToDB(questions[currentIndex]?.id, answer);
    setCurrentIndex(idx); timer.switchToQuestion(idx); speech.stopListening(); speech.resetTranscript(); setAnswer(questionsRef.current[idx]?.user_answer || '');
  };

  const finishInterview = async () => {
    speech.stopListening(); setSubmitting(true);
    try {
      updateQuestionAnswer(currentIndex, answer);
      const finalQuestions = questionsRef.current.map((q, i) => ({ ...q, user_answer: i === currentIndex ? answer : (q.user_answer || '') }));
      const savedIds = finalQuestions.filter(q => q.id && !q.id.startsWith('temp-'));
      if (savedIds.length > 0) await Promise.all(savedIds.map(q => saveAnswerToDB(q.id!, q.user_answer || '')));
      else if (finalQuestions.length > 0) {
        const { data: saved } = await supabase.from('interview_questions').insert(finalQuestions.map(q => ({ interview_id: id, question_type: q.question_type, difficulty: q.difficulty, question_text: q.question_text, expected_answer: q.expected_answer || '', user_answer: q.user_answer || '' }))).select();
        if (saved) questionsRef.current = saved;
      }
      const { data, error } = await supabase.functions.invoke('evaluate-interview', { body: { interviewId: id, questionsData: finalQuestions.map(q => ({ question_type: q.question_type, difficulty: q.difficulty, question_text: q.question_text, expected_answer: q.expected_answer || '', user_answer: q.user_answer || '', user_code: '' })) } });
      if (error) throw error;
      if (data.error === 'no_questions') { toast.error('No questions could be evaluated.'); setSubmitting(false); return; }
      await supabase.from('interviews').update({ status: 'completed', completed_at: new Date().toISOString(), total_score: data.totalScore, max_score: data.maxScore, feedback: data.feedback }).eq('id', id);
      if (stream) stream.getTracks().forEach(t => t.stop());
      toast.success('Interview completed!'); navigate(`/interview/results/${id}`);
    } catch (error) { console.error('Error:', error); toast.error('Failed to submit interview.'); }
    finally { setSubmitting(false); }
  };

  if (authLoading || loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div></div>;
  if (generating) return <div className="min-h-screen flex flex-col items-center justify-center gap-4"><Loader2 className="h-12 w-12 text-primary animate-spin" /><p className="text-lg font-medium">Preparing your HR interview...</p></div>;

  const currentQuestion = questions[currentIndex];

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 pt-16">
        <div className="border-b border-border bg-card/50 backdrop-blur-xl sticky top-16 z-40">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-warning/10"><Video className="h-5 w-5 text-warning" /></div>
                <div><p className="font-medium">HR / Behavioral Interview</p><p className="text-sm text-muted-foreground">Question {currentIndex + 1} of {questions.length}</p></div>
              </div>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 text-muted-foreground"><Clock className="h-4 w-4" /><span className="timer-display">{timer.formattedTotalTime}</span></div>
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-warning/10 text-warning text-sm font-medium"><Timer className="h-3.5 w-3.5" /><span>{timer.formattedQuestionTime}</span></div>
                </div>
                <Button variant="hero" onClick={finishInterview} disabled={submitting}>{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Finish Interview<Check className="h-4 w-4" /></>}</Button>
              </div>
            </div>
          </div>
        </div>

        <div className="h-1 bg-secondary"><div className="h-full bg-warning transition-all duration-300" style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }} /></div>

        <div className="container mx-auto px-4 py-8">
          {currentQuestion && (
            <div className="grid lg:grid-cols-2 gap-6">
              <motion.div key={currentIndex} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                <div className="glass-card p-4">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-medium flex items-center gap-2"><Camera className="h-4 w-4" />Practice Mode</span>
                    <div className="flex items-center gap-2">
                      <Button variant={isVideoOn ? "default" : "outline"} size="sm" onClick={toggleVideo}>{isVideoOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}</Button>
                      <Button variant={isMicOn ? "default" : "outline"} size="sm" onClick={toggleMic}>{isMicOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}</Button>
                    </div>
                  </div>
                  <div className="aspect-video bg-background/50 rounded-lg overflow-hidden relative">
                    {isVideoOn ? <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover transform scale-x-[-1]" /> : (
                      <div className="flex items-center justify-center h-full"><div className="text-center"><VideoOff className="h-12 w-12 mx-auto text-muted-foreground mb-2" /><p className="text-sm text-muted-foreground">Camera is off</p><Button variant="outline" size="sm" className="mt-2" onClick={toggleVideo}>Enable Camera</Button></div></div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 text-center">💡 Tip: Practice maintaining eye contact with the camera</p>
                </div>
                <div className="glass-card p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${currentQuestion.difficulty === 'easy' ? 'bg-success/20 text-success' : currentQuestion.difficulty === 'medium' ? 'bg-warning/20 text-warning' : 'bg-destructive/20 text-destructive'}`}>{currentQuestion.difficulty.toUpperCase()}</span>
                    <span className="px-2 py-1 rounded text-xs font-medium bg-warning/20 text-warning">Behavioral Question</span>
                  </div>
                  <div className="prose prose-invert max-w-none"><ReactMarkdown>{currentQuestion.question_text}</ReactMarkdown></div>
                </div>
              </motion.div>

              <motion.div key={`answer-${currentIndex}`} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="glass-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2"><MessageSquare className="h-5 w-5 text-primary" /><span className="font-medium">Your Response</span></div>
                  {speech.isSupported && (
                    <Button variant={speech.isListening ? "destructive" : "outline"} size="sm" onClick={speech.toggleListening} className="gap-2">
                      {speech.isListening ? <><StopCircle className="h-4 w-4 animate-pulse" />Stop Recording</> : <><MicIcon className="h-4 w-4" />Voice Input</>}
                    </Button>
                  )}
                </div>
                {speech.isListening && (
                  <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
                    <span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive"></span></span>Listening...
                  </div>
                )}
                <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Type your answer or click 'Voice Input' to speak..." className="min-h-[250px] resize-none" />
                <div className="mt-4 p-4 rounded-lg bg-secondary/30">
                  <p className="text-sm font-medium mb-2">💡 Tips for a great answer:</p>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• Use the STAR method: Situation, Task, Action, Result</li>
                    <li>• Be specific with examples from your experience</li>
                    <li>• Keep your answer focused and concise (1-2 minutes)</li>
                  </ul>
                </div>
                <div className="mt-4 flex justify-end">
                  <Button onClick={() => { updateQuestionAnswer(currentIndex, answer); saveAnswer(); toast.success('Answer saved'); }} variant="outline"><Send className="h-4 w-4 mr-2" />Save Answer</Button>
                </div>
              </motion.div>
            </div>
          )}

          <div className="flex items-center justify-between mt-8">
            <Button variant="outline" onClick={prevQuestion} disabled={currentIndex === 0}><ChevronLeft className="h-4 w-4 mr-2" />Previous</Button>
            <div className="flex items-center gap-2">
              {questions.map((_, idx) => (
                <button key={idx} onClick={() => goToQuestion(idx)} className={`w-8 h-8 rounded-full text-sm font-medium transition-all ${idx === currentIndex ? 'bg-warning text-warning-foreground' : questionsRef.current[idx]?.user_answer ? 'bg-success/30 text-success' : 'bg-secondary hover:bg-secondary/80'}`}>{idx + 1}</button>
              ))}
            </div>
            <Button onClick={nextQuestion} disabled={currentIndex === questions.length - 1}>Next<ChevronRight className="h-4 w-4 ml-2" /></Button>
          </div>
        </div>
      </main>
    </div>
  );
}
