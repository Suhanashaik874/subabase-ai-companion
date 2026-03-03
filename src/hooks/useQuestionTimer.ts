import { useState, useEffect, useRef, useCallback } from 'react';

interface QuestionTimerState {
  questionTime: number;
  questionTimes: Record<number, number>;
  totalTime: number;
  switchToQuestion: (index: number) => void;
  formattedQuestionTime: string;
  formattedTotalTime: string;
  getFormattedTime: (index: number) => string;
}

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

export function useQuestionTimer(initialIndex = 0): QuestionTimerState {
  const [questionTime, setQuestionTime] = useState(0);
  const [totalTime, setTotalTime] = useState(0);
  const [questionTimes, setQuestionTimes] = useState<Record<number, number>>({});
  const currentIndexRef = useRef(initialIndex);
  const questionTimeRef = useRef(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setQuestionTime(prev => {
        const next = prev + 1;
        questionTimeRef.current = next;
        return next;
      });
      setTotalTime(prev => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const switchToQuestion = useCallback((newIndex: number) => {
    setQuestionTimes(prev => ({
      ...prev,
      [currentIndexRef.current]: (prev[currentIndexRef.current] || 0) + questionTimeRef.current,
    }));
    currentIndexRef.current = newIndex;
    questionTimeRef.current = 0;
    setQuestionTime(0);
  }, []);

  const getFormattedTime = useCallback((index: number) => {
    const saved = questionTimes[index] || 0;
    const extra = index === currentIndexRef.current ? questionTimeRef.current : 0;
    return formatTime(saved + extra);
  }, [questionTimes]);

  return {
    questionTime,
    questionTimes,
    totalTime,
    switchToQuestion,
    formattedQuestionTime: formatTime(questionTime),
    formattedTotalTime: formatTime(totalTime),
    getFormattedTime,
  };
}
